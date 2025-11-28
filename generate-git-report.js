#!/usr/bin/env node

/**
 * Git Report Generator - Reluna Style
 * Generates HTML report with proper git graph visualization
 *
 * Algorithm: Process commits in topological order (newest first).
 * Each lane tracks which commit hash it's waiting for.
 * When a commit is processed:
 * - If it matches an existing lane, use that lane
 * - Otherwise create a new lane (this is a branch tip)
 * - When we reach a commit's parent, the lane continues
 * - When a lane's target hash is never found, the lane ends (branch started after our window)
 */

const { execSync } = require('child_process');
const fs = require('fs');

const WEEKS = process.argv[2] || 3;
const OUTPUT_FILE = `git-report-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.html`;

// Check if "all" was passed
const isAllHistory = WEEKS === 'all';
const sinceArg = isAllHistory ? '' : `--since="${WEEKS} weeks ago"`;

console.log(`🔍 Collecting git data${isAllHistory ? ' (full history)' : ` for last ${WEEKS} weeks`}...`);

// Get commits with full info
const gitLog = execSync(
  `git log --all ${sinceArg} --pretty=format:'%H|%P|%s|%an|%ad|%d' --date=short --topo-order`,
  { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 }
);

const commits = gitLog.trim().split('\n').filter(Boolean).map(line => {
  const [hash, parents, message, author, date, refs] = line.split('|');
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    message,
    author,
    date,
    refs: refs || '',
    column: 0,
    color: 0
  };
});

console.log(`📊 Found ${commits.length} commits`);

// Create lookup map for quick parent->child relationships
const commitMap = new Map();
commits.forEach(c => commitMap.set(c.hash, c));

// Get unique authors
const authors = [...new Set(commits.map(c => c.author))];
const authorColors = {};
authors.forEach((a, i) => authorColors[a] = i % 10);

// Reluna brand colors
const COLORS = [
  '#fb6428', // family orange (primary)
  '#005CCD', // advisor blue
  '#8FCD00', // admin lime
  '#1ca693', // success teal
  '#eaa000', // warning amber
  '#cc0505', // error red
  '#0069d1', // info blue
  '#8b5cf6', // purple
];

const MAX_COLUMNS = 50; // Практически без ограничений

/**
 * Improved lane tracking algorithm
 *
 * Key insight: We process commits top-to-bottom (newest to oldest).
 * A "lane" represents an active line going DOWN looking for a specific commit hash.
 *
 * When we see a commit:
 * - Check if any lane is waiting for this commit's hash
 * - If yes: this commit occupies that lane, lane now waits for commit's parent
 * - If no: this is a new branch tip, create new lane
 *
 * Lines should only be drawn when there's actually a path between commits.
 */

let lanes = []; // Array of { targetHash, column, color }
let maxColumn = 0;

function getNextFreeColumn() {
  for (let i = 0; i < MAX_COLUMNS; i++) {
    if (!lanes.some(l => l.column === i)) return i;
  }
  return MAX_COLUMNS - 1;
}

// First pass: assign columns to commits
commits.forEach((commit, idx) => {
  // Save which lanes exist BEFORE processing this commit
  commit.lanesBeforeCommit = lanes.map(l => ({ column: l.column, color: l.color, targetHash: l.targetHash }));

  // Find if any lane is waiting for this commit
  const laneIdx = lanes.findIndex(l => l.targetHash === commit.hash);

  if (laneIdx >= 0) {
    // This commit was expected by an existing lane
    commit.column = lanes[laneIdx].column;
    commit.color = lanes[laneIdx].color;

    // Check if there are OTHER lanes also waiting for this same commit (merge point)
    const mergingLanes = lanes.filter((l, i) => i !== laneIdx && l.targetHash === commit.hash);
    commit.mergingFromColumns = mergingLanes.map(l => l.column);

    // Remove all lanes that were targeting this commit
    lanes = lanes.filter(l => l.targetHash !== commit.hash);

    // Now add lanes for this commit's parents
    if (commit.parents.length > 0) {
      // First parent continues in the same column
      lanes.push({
        targetHash: commit.parents[0],
        column: commit.column,
        color: commit.color
      });

      // Additional parents get new columns (merge sources)
      for (let i = 1; i < commit.parents.length; i++) {
        const parentHash = commit.parents[i];
        // Only add if not already tracked
        if (!lanes.some(l => l.targetHash === parentHash)) {
          const newCol = getNextFreeColumn();
          if (newCol > maxColumn) maxColumn = Math.min(newCol, MAX_COLUMNS - 1);
          lanes.push({
            targetHash: parentHash,
            column: newCol,
            color: newCol % COLORS.length
          });
        }
      }
    }
  } else {
    // This commit is not expected by any lane - it's a new branch tip
    const newCol = getNextFreeColumn();
    if (newCol > maxColumn) maxColumn = Math.min(newCol, MAX_COLUMNS - 1);
    commit.column = newCol;
    commit.color = newCol % COLORS.length;
    commit.isNewBranch = true;
    commit.mergingFromColumns = [];

    // Add lanes for parents
    if (commit.parents.length > 0) {
      lanes.push({
        targetHash: commit.parents[0],
        column: newCol,
        color: commit.color
      });

      for (let i = 1; i < commit.parents.length; i++) {
        const parentHash = commit.parents[i];
        if (!lanes.some(l => l.targetHash === parentHash)) {
          const mergeCol = getNextFreeColumn();
          if (mergeCol > maxColumn) maxColumn = Math.min(mergeCol, MAX_COLUMNS - 1);
          lanes.push({
            targetHash: parentHash,
            column: mergeCol,
            color: mergeCol % COLORS.length
          });
        }
      }
    }
  }

  // Save which lanes exist AFTER processing this commit
  commit.lanesAfterCommit = lanes.map(l => ({ column: l.column, color: l.color, targetHash: l.targetHash }));
});

console.log(`📝 Max columns: ${maxColumn + 1}`);

// Generate HTML
const COLUMN_WIDTH = 14;
const GRAPH_WIDTH = (maxColumn + 2) * COLUMN_WIDTH + 20;

function getCommitType(message) {
  if (/^feat/i.test(message)) return 'feat';
  if (/^fix/i.test(message)) return 'fix';
  if (/^refactor/i.test(message)) return 'refactor';
  if (/^docs/i.test(message)) return 'docs';
  if (/^chore/i.test(message)) return 'chore';
  if (/merge/i.test(message)) return 'merge';
  return 'other';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseBranchTags(refs) {
  if (!refs) return '';
  let html = '';

  if (refs.includes('HEAD')) {
    html += '<span class="tag tag-head">HEAD</span>';
  }

  const originBranches = refs.match(/origin\/([^,)\s]+)/g) || [];
  originBranches.slice(0, 2).forEach(b => {
    const name = b.replace('origin/', '');
    html += `<span class="tag tag-remote">${escapeHtml(name)}</span>`;
  });

  return html;
}

function generateSvgLines(commit) {
  const lines = [];
  const myX = 10 + commit.column * COLUMN_WIDTH;
  const h = 28; // row height

  // Collect columns from before and after
  const beforeCols = new Map(); // column -> color
  const afterCols = new Map();  // column -> color

  commit.lanesBeforeCommit.forEach(lane => {
    beforeCols.set(lane.column, lane.color);
  });

  commit.lanesAfterCommit.forEach(lane => {
    afterCols.set(lane.column, lane.color);
  });

  // Get all unique columns that need lines
  const allColumns = new Set([...beforeCols.keys(), ...afterCols.keys()]);

  allColumns.forEach(col => {
    const x = 10 + col * COLUMN_WIDTH;
    const colorIdx = beforeCols.has(col) ? beforeCols.get(col) : afterCols.get(col);
    const color = COLORS[colorIdx % COLORS.length];

    const hasBefore = beforeCols.has(col);
    const hasAfter = afterCols.has(col);
    const isMyColumn = col === commit.column;

    if (hasBefore && hasAfter) {
      // Line passes through completely
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${color}" stroke-width="2"/>`);
    } else if (hasBefore && !hasAfter) {
      // Line ends at this row (at the dot level for commit column, or just ends)
      if (isMyColumn) {
        // Line comes in and ends at the commit dot
        lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="14" stroke="${color}" stroke-width="2"/>`);
      } else {
        // This is a merge line coming in from side
        lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="14" stroke="${color}" stroke-width="2"/>`);
      }
    } else if (!hasBefore && hasAfter) {
      // Line starts here (new branch beginning)
      lines.push(`<line x1="${x}" y1="14" x2="${x}" y2="${h}" stroke="${color}" stroke-width="2"/>`);
    }
  });

  // Draw merge horizontal lines from merging columns to commit column
  if (commit.mergingFromColumns && commit.mergingFromColumns.length > 0) {
    commit.mergingFromColumns.forEach(mergeCol => {
      const fromX = 10 + mergeCol * COLUMN_WIDTH;
      const color = COLORS[mergeCol % COLORS.length];
      lines.push(`<line x1="${Math.min(fromX, myX)}" y1="14" x2="${Math.max(fromX, myX)}" y2="14" stroke="${color}" stroke-width="2"/>`);
    });
  }

  // Draw horizontal lines for merge parents (going to new lanes)
  if (commit.parents.length > 1) {
    for (let i = 1; i < commit.parents.length; i++) {
      const parentHash = commit.parents[i];
      const parentLane = commit.lanesAfterCommit.find(l => l.targetHash === parentHash);
      if (parentLane && parentLane.column !== commit.column) {
        const toX = 10 + parentLane.column * COLUMN_WIDTH;
        const color = COLORS[parentLane.color % COLORS.length];
        lines.push(`<line x1="${Math.min(toX, myX)}" y1="14" x2="${Math.max(toX, myX)}" y2="14" stroke="${color}" stroke-width="2"/>`);
      }
    }
  }

  return lines.join('');
}

const stats = {
  total: commits.length,
  authors: authors.length,
  prs: commits.filter(c => c.message.includes('Merge pull request')).length
};

const repoName = execSync('basename $(git rev-parse --show-toplevel)', { encoding: 'utf-8' }).trim();
const periodLabel = isAllHistory ? 'вся история' : `${WEEKS} недель`;

let html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git History - ${repoName}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #fb6428;
            --text-primary: #121212;
            --text-secondary: rgba(18, 18, 18, 0.5);
            --text-tertiary: rgba(18, 18, 18, 0.35);
            --bg-primary: #ffffff;
            --bg-secondary: #f6f8fa;
            --bg-tertiary: rgba(18, 18, 18, 0.05);
            --border-primary: rgba(18, 18, 18, 0.1);
            --border-secondary: rgba(18, 18, 18, 0.05);
            --success: #1ca693;
            --warning: #eaa000;
            --error: #cc0505;
            --info: #0069d1;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-secondary);
            color: var(--text-primary);
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #fb6428 0%, #e55a20 100%);
            padding: 24px 32px;
            color: white;
        }
        .header h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        .header p {
            opacity: 0.9;
            font-size: 14px;
        }
        .stats {
            display: flex;
            gap: 32px;
            margin-top: 16px;
        }
        .stat { text-align: center; }
        .stat .number {
            font-size: 32px;
            font-weight: 700;
        }
        .stat .label {
            font-size: 12px;
            opacity: 0.8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .filters {
            padding: 12px 24px;
            background: var(--bg-primary);
            display: flex;
            gap: 8px;
            align-items: center;
            border-bottom: 1px solid var(--border-primary);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .filter-btn {
            padding: 6px 16px;
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            background: transparent;
            color: var(--text-primary);
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s;
        }
        .filter-btn:hover {
            background: var(--bg-tertiary);
        }
        .filter-btn.active {
            background: var(--primary);
            border-color: var(--primary);
            color: white;
        }
        .search-input {
            padding: 8px 16px;
            border: 1px solid var(--border-primary);
            border-radius: 6px;
            background: var(--bg-primary);
            color: var(--text-primary);
            width: 240px;
            font-size: 13px;
            margin-left: auto;
        }
        .search-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(251, 100, 40, 0.1);
        }

        .git-graph {
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            font-size: 12px;
            background: var(--bg-primary);
        }
        .commit-row {
            display: flex;
            align-items: center;
            height: 28px;
            border-bottom: 1px solid var(--border-secondary);
            transition: background 0.1s;
        }
        .commit-row:hover {
            background: var(--bg-tertiary);
        }
        .graph-cell {
            width: ${GRAPH_WIDTH}px;
            min-width: ${GRAPH_WIDTH}px;
            height: 28px;
            position: relative;
            background: var(--bg-secondary);
            border-right: 1px solid var(--border-secondary);
        }
        .graph-svg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
        }
        .commit-dot {
            position: absolute;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            top: 10px;
            border: 2px solid var(--bg-secondary);
            z-index: 2;
        }
        .commit-info {
            flex: 1;
            display: flex;
            align-items: center;
            padding: 0 16px;
            gap: 12px;
            min-width: 0;
        }
        .commit-hash {
            color: var(--primary);
            font-size: 11px;
            font-weight: 600;
            width: 60px;
        }
        .commit-message {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--text-primary);
        }
        .commit-author {
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            white-space: nowrap;
            max-width: 130px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .commit-date {
            color: var(--text-tertiary);
            font-size: 11px;
            width: 75px;
        }
        .tag {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            margin-right: 6px;
        }
        .tag-head {
            background: var(--info);
            color: white;
        }
        .tag-remote {
            background: var(--success);
            color: white;
        }
        .merge-icon {
            color: var(--text-tertiary);
            margin-right: 6px;
            font-size: 14px;
        }

        /* Author colors - Reluna palette based */
        .a0 { background: rgba(251, 100, 40, 0.15); color: #c04d1a; }
        .a1 { background: rgba(0, 92, 205, 0.15); color: #004a9e; }
        .a2 { background: rgba(143, 205, 0, 0.15); color: #5a8200; }
        .a3 { background: rgba(28, 166, 147, 0.15); color: #148577; }
        .a4 { background: rgba(234, 160, 0, 0.15); color: #b37b00; }
        .a5 { background: rgba(204, 5, 5, 0.15); color: #a00404; }
        .a6 { background: rgba(0, 105, 209, 0.15); color: #0054a8; }
        .a7 { background: rgba(139, 92, 246, 0.15); color: #6d3bd4; }
        .a8 { background: rgba(18, 18, 18, 0.08); color: var(--text-secondary); }
        .a9 { background: rgba(251, 100, 40, 0.1); color: #c04d1a; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 ${repoName}</h1>
        <p>Git History • Период: ${periodLabel} • ${new Date().toLocaleDateString('ru-RU')}</p>
        <div class="stats">
            <div class="stat"><div class="number">${stats.total}</div><div class="label">коммитов</div></div>
            <div class="stat"><div class="number">${stats.authors}</div><div class="label">авторов</div></div>
            <div class="stat"><div class="number">${stats.prs}</div><div class="label">Pull Requests</div></div>
        </div>
    </div>

    <div class="filters">
        <button class="filter-btn active" onclick="filter('all')">Все</button>
        <button class="filter-btn" onclick="filter('feat')">Features</button>
        <button class="filter-btn" onclick="filter('fix')">Fixes</button>
        <button class="filter-btn" onclick="filter('merge')">Merges</button>
        <button class="filter-btn" onclick="filter('refactor')">Refactor</button>
        <input type="text" class="search-input" placeholder="Поиск по коммитам..." oninput="search(this.value)">
    </div>

    <div class="git-graph">
`;

// Generate rows
commits.forEach((commit, idx) => {
  const type = getCommitType(commit.message);
  const dotX = 10 + commit.column * COLUMN_WIDTH;
  const svgLines = generateSvgLines(commit);
  const branchTags = parseBranchTags(commit.refs);
  const mergeIcon = commit.parents.length > 1 ? '<span class="merge-icon">⎇</span>' : '';
  const authorColor = authorColors[commit.author] || 0;

  html += `        <div class="commit-row" data-type="${type}" data-search="${escapeHtml(commit.message + ' ' + commit.author).toLowerCase()}">
            <div class="graph-cell">
                <svg class="graph-svg">${svgLines}</svg>
                <div class="commit-dot" style="left: ${dotX - 4}px; background: ${COLORS[commit.color]};"></div>
            </div>
            <div class="commit-info">
                <span class="commit-hash">${commit.shortHash}</span>
                ${branchTags}${mergeIcon}
                <span class="commit-message">${escapeHtml(commit.message)}</span>
                <span class="commit-author a${authorColor}">${escapeHtml(commit.author)}</span>
                <span class="commit-date">${commit.date}</span>
            </div>
        </div>
`;
});

html += `    </div>
    <script>
        function filter(type) {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            document.querySelectorAll('.commit-row').forEach(row => {
                row.style.display = (type === 'all' || row.dataset.type === type) ? '' : 'none';
            });
        }
        function search(q) {
            const query = q.toLowerCase();
            document.querySelectorAll('.commit-row').forEach(row => {
                row.style.display = row.dataset.search.includes(query) ? '' : 'none';
            });
        }
    </script>
</body>
</html>`;

fs.writeFileSync(OUTPUT_FILE, html);
console.log(`✅ Report generated: ${OUTPUT_FILE}`);

// Try to open, but don't fail if it doesn't work
try {
  execSync(`open ${OUTPUT_FILE}`);
} catch (e) {
  console.log(`📁 Open the file manually: ${OUTPUT_FILE}`);
}
