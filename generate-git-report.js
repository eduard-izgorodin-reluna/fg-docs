#!/usr/bin/env node

/**
 * Git Report Generator - Reluna Style
 * Generates HTML report with proper git graph visualization
 * Supports snapshots for comparing history over time
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WEEKS = process.argv[2] || 3;
const OUTPUT_DIR = process.argv[3] || '.';
const TODAY = new Date().toISOString().slice(0, 10);

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

// Create lookup map
const commitMap = new Map();
commits.forEach(c => commitMap.set(c.hash, c));

// Get unique authors
const authors = [...new Set(commits.map(c => c.author))];
const authorColors = {};
authors.forEach((a, i) => authorColors[a] = i % 10);

// Reluna brand colors
const COLORS = [
  '#fb6428', '#005CCD', '#8FCD00', '#1ca693',
  '#eaa000', '#cc0505', '#0069d1', '#8b5cf6',
];

const MAX_COLUMNS = 50;

let lanes = [];
let maxColumn = 0;

function getNextFreeColumn() {
  for (let i = 0; i < MAX_COLUMNS; i++) {
    if (!lanes.some(l => l.column === i)) return i;
  }
  return MAX_COLUMNS - 1;
}

// Process commits - assign columns
commits.forEach((commit) => {
  commit.lanesBeforeCommit = lanes.map(l => ({ column: l.column, color: l.color, targetHash: l.targetHash }));

  const laneIdx = lanes.findIndex(l => l.targetHash === commit.hash);

  if (laneIdx >= 0) {
    commit.column = lanes[laneIdx].column;
    commit.color = lanes[laneIdx].color;

    const mergingLanes = lanes.filter((l, i) => i !== laneIdx && l.targetHash === commit.hash);
    commit.mergingFromColumns = mergingLanes.map(l => l.column);

    lanes = lanes.filter(l => l.targetHash !== commit.hash);

    if (commit.parents.length > 0) {
      lanes.push({ targetHash: commit.parents[0], column: commit.column, color: commit.color });

      for (let i = 1; i < commit.parents.length; i++) {
        const parentHash = commit.parents[i];
        if (!lanes.some(l => l.targetHash === parentHash)) {
          const newCol = getNextFreeColumn();
          if (newCol > maxColumn) maxColumn = Math.min(newCol, MAX_COLUMNS - 1);
          lanes.push({ targetHash: parentHash, column: newCol, color: newCol % COLORS.length });
        }
      }
    }
  } else {
    const newCol = getNextFreeColumn();
    if (newCol > maxColumn) maxColumn = Math.min(newCol, MAX_COLUMNS - 1);
    commit.column = newCol;
    commit.color = newCol % COLORS.length;
    commit.isNewBranch = true;
    commit.mergingFromColumns = [];

    if (commit.parents.length > 0) {
      lanes.push({ targetHash: commit.parents[0], column: newCol, color: commit.color });

      for (let i = 1; i < commit.parents.length; i++) {
        const parentHash = commit.parents[i];
        if (!lanes.some(l => l.targetHash === parentHash)) {
          const mergeCol = getNextFreeColumn();
          if (mergeCol > maxColumn) maxColumn = Math.min(mergeCol, MAX_COLUMNS - 1);
          lanes.push({ targetHash: parentHash, column: mergeCol, color: mergeCol % COLORS.length });
        }
      }
    }
  }

  commit.lanesAfterCommit = lanes.map(l => ({ column: l.column, color: l.color, targetHash: l.targetHash }));
});

console.log(`📝 Max columns: ${maxColumn + 1}`);

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
  if (refs.includes('HEAD')) html += '<span class="tag tag-head">HEAD</span>';
  const originBranches = refs.match(/origin\/([^,)\s]+)/g) || [];
  originBranches.slice(0, 2).forEach(b => {
    html += `<span class="tag tag-remote">${escapeHtml(b.replace('origin/', ''))}</span>`;
  });
  return html;
}

function generateSvgLines(commit) {
  const lines = [];
  const myX = 10 + commit.column * COLUMN_WIDTH;
  const h = 28;

  const beforeCols = new Map();
  const afterCols = new Map();

  commit.lanesBeforeCommit.forEach(lane => beforeCols.set(lane.column, lane.color));
  commit.lanesAfterCommit.forEach(lane => afterCols.set(lane.column, lane.color));

  const allColumns = new Set([...beforeCols.keys(), ...afterCols.keys()]);

  allColumns.forEach(col => {
    const x = 10 + col * COLUMN_WIDTH;
    const colorIdx = beforeCols.has(col) ? beforeCols.get(col) : afterCols.get(col);
    const color = COLORS[colorIdx % COLORS.length];

    const hasBefore = beforeCols.has(col);
    const hasAfter = afterCols.has(col);

    if (hasBefore && hasAfter) {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${color}" stroke-width="2"/>`);
    } else if (hasBefore && !hasAfter) {
      lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="14" stroke="${color}" stroke-width="2"/>`);
    } else if (!hasBefore && hasAfter) {
      lines.push(`<line x1="${x}" y1="14" x2="${x}" y2="${h}" stroke="${color}" stroke-width="2"/>`);
    }
  });

  if (commit.mergingFromColumns && commit.mergingFromColumns.length > 0) {
    commit.mergingFromColumns.forEach(mergeCol => {
      const fromX = 10 + mergeCol * COLUMN_WIDTH;
      const color = COLORS[mergeCol % COLORS.length];
      lines.push(`<line x1="${Math.min(fromX, myX)}" y1="14" x2="${Math.max(fromX, myX)}" y2="14" stroke="${color}" stroke-width="2"/>`);
    });
  }

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

// Generate snapshot HTML (without selector - standalone)
function generateSnapshotHtml() {
  let html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git History - ${repoName} - ${TODAY}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #fb6428; --text-primary: #121212; --text-secondary: rgba(18,18,18,0.5); --text-tertiary: rgba(18,18,18,0.35); --bg-primary: #fff; --bg-secondary: #f6f8fa; --bg-tertiary: rgba(18,18,18,0.05); --border-primary: rgba(18,18,18,0.1); --border-secondary: rgba(18,18,18,0.05); --success: #1ca693; --info: #0069d1; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg-secondary); color: var(--text-primary); min-height: 100vh; }
        .header { background: linear-gradient(135deg, #fb6428 0%, #e55a20 100%); padding: 24px 32px; color: white; }
        .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .header p { opacity: 0.9; font-size: 14px; }
        .stats { display: flex; gap: 32px; margin-top: 16px; }
        .stat { text-align: center; }
        .stat .number { font-size: 32px; font-weight: 700; }
        .stat .label { font-size: 12px; opacity: 0.8; text-transform: uppercase; }
        .filters { padding: 12px 24px; background: var(--bg-primary); display: flex; gap: 8px; align-items: center; border-bottom: 1px solid var(--border-primary); position: sticky; top: 0; z-index: 100; }
        .filter-btn { padding: 6px 16px; border: 1px solid var(--border-primary); border-radius: 6px; background: transparent; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.15s; }
        .filter-btn:hover { background: var(--bg-tertiary); }
        .filter-btn.active { background: var(--primary); border-color: var(--primary); color: white; }
        .search-input { padding: 8px 16px; border: 1px solid var(--border-primary); border-radius: 6px; width: 240px; font-size: 13px; margin-left: auto; }
        .search-input:focus { outline: none; border-color: var(--primary); }
        .git-graph { font-family: 'SF Mono', Monaco, monospace; font-size: 12px; background: var(--bg-primary); }
        .commit-row { display: flex; align-items: center; height: 28px; border-bottom: 1px solid var(--border-secondary); }
        .commit-row:hover { background: var(--bg-tertiary); }
        .graph-cell { width: ${GRAPH_WIDTH}px; min-width: ${GRAPH_WIDTH}px; height: 28px; position: relative; background: var(--bg-secondary); border-right: 1px solid var(--border-secondary); }
        .graph-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
        .commit-dot { position: absolute; width: 8px; height: 8px; border-radius: 50%; top: 10px; border: 2px solid var(--bg-secondary); z-index: 2; }
        .commit-info { flex: 1; display: flex; align-items: center; padding: 0 16px; gap: 12px; min-width: 0; }
        .commit-hash { color: var(--primary); font-size: 11px; font-weight: 600; width: 60px; }
        .commit-message { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .commit-author { padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 500; max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
        .commit-date { color: var(--text-tertiary); font-size: 11px; width: 75px; }
        .tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-right: 6px; }
        .tag-head { background: var(--info); color: white; }
        .tag-remote { background: var(--success); color: white; }
        .merge-icon { color: var(--text-tertiary); margin-right: 6px; }
        .a0 { background: rgba(251,100,40,0.15); color: #c04d1a; }
        .a1 { background: rgba(0,92,205,0.15); color: #004a9e; }
        .a2 { background: rgba(143,205,0,0.15); color: #5a8200; }
        .a3 { background: rgba(28,166,147,0.15); color: #148577; }
        .a4 { background: rgba(234,160,0,0.15); color: #b37b00; }
        .a5 { background: rgba(204,5,5,0.15); color: #a00404; }
        .a6 { background: rgba(0,105,209,0.15); color: #0054a8; }
        .a7 { background: rgba(139,92,246,0.15); color: #6d3bd4; }
        .a8 { background: rgba(18,18,18,0.08); color: var(--text-secondary); }
        .a9 { background: rgba(251,100,40,0.1); color: #c04d1a; }
        .back-link { display: inline-block; margin-bottom: 8px; color: white; opacity: 0.8; text-decoration: none; font-size: 13px; }
        .back-link:hover { opacity: 1; }
    </style>
</head>
<body>
    <div class="header">
        <a href="../git-history.html" class="back-link">← Все слепки</a>
        <h1>📊 ${repoName}</h1>
        <p>Слепок: ${TODAY} • ${periodLabel} • ${stats.total} коммитов</p>
        <div class="stats">
            <div class="stat"><div class="number">${stats.total}</div><div class="label">коммитов</div></div>
            <div class="stat"><div class="number">${stats.authors}</div><div class="label">авторов</div></div>
            <div class="stat"><div class="number">${stats.prs}</div><div class="label">PRs</div></div>
        </div>
    </div>
    <div class="filters">
        <button class="filter-btn active" onclick="filter('all')">Все</button>
        <button class="filter-btn" onclick="filter('feat')">Features</button>
        <button class="filter-btn" onclick="filter('fix')">Fixes</button>
        <button class="filter-btn" onclick="filter('merge')">Merges</button>
        <input type="text" class="search-input" placeholder="Поиск..." oninput="search(this.value)">
    </div>
    <div class="git-graph">
`;

  commits.forEach((commit) => {
    const type = getCommitType(commit.message);
    const dotX = 10 + commit.column * COLUMN_WIDTH;
    const svgLines = generateSvgLines(commit);
    const branchTags = parseBranchTags(commit.refs);
    const mergeIcon = commit.parents.length > 1 ? '<span class="merge-icon">⎇</span>' : '';
    const authorColor = authorColors[commit.author] || 0;

    html += `<div class="commit-row" data-type="${type}" data-hash="${commit.shortHash}" data-search="${escapeHtml(commit.message + ' ' + commit.author).toLowerCase()}">
            <div class="graph-cell"><svg class="graph-svg">${svgLines}</svg><div class="commit-dot" style="left:${dotX - 4}px;background:${COLORS[commit.color]};"></div></div>
            <div class="commit-info">
                <span class="commit-hash">${commit.shortHash}</span>${branchTags}${mergeIcon}
                <span class="commit-message">${escapeHtml(commit.message)}</span>
                <span class="commit-author a${authorColor}">${escapeHtml(commit.author)}</span>
                <span class="commit-date">${commit.date}</span>
            </div>
        </div>
`;
  });

  html += `</div>
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

  return html;
}

// Generate main page with snapshot selector
function generateMainPage(snapshots) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git History - ${repoName}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #fb6428; --text-primary: #121212; --bg-primary: #fff; --bg-secondary: #f6f8fa; --border-primary: rgba(18,18,18,0.1); --success: #1ca693; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg-secondary); min-height: 100vh; }
        .header { background: linear-gradient(135deg, #fb6428 0%, #e55a20 100%); padding: 32px; color: white; text-align: center; }
        .header h1 { font-size: 28px; margin-bottom: 8px; }
        .header p { opacity: 0.9; }
        .container { max-width: 800px; margin: 0 auto; padding: 32px; }
        .card { background: var(--bg-primary); border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .card h2 { font-size: 18px; margin-bottom: 16px; color: var(--text-primary); }
        .snapshot-list { list-style: none; }
        .snapshot-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border: 1px solid var(--border-primary); border-radius: 8px; margin-bottom: 8px; transition: all 0.15s; }
        .snapshot-item:hover { border-color: var(--primary); background: rgba(251,100,40,0.05); }
        .snapshot-date { font-weight: 600; color: var(--text-primary); }
        .snapshot-stats { font-size: 13px; color: rgba(18,18,18,0.5); }
        .snapshot-link { padding: 8px 16px; background: var(--primary); color: white; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 500; }
        .snapshot-link:hover { background: #e55a20; }
        .compare-section { margin-top: 24px; }
        .compare-row { display: flex; gap: 16px; align-items: center; }
        .compare-select { flex: 1; padding: 10px 16px; border: 1px solid var(--border-primary); border-radius: 6px; font-size: 14px; }
        .compare-btn { padding: 10px 24px; background: var(--success); color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .compare-btn:hover { background: #158a7a; }
        .latest-badge { background: var(--success); color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Git History</h1>
        <p>${repoName} • Слепки истории коммитов</p>
    </div>
    <div class="container">
        <div class="card">
            <h2>Доступные слепки</h2>
            <ul class="snapshot-list">
${snapshots.map((s, i) => `                <li class="snapshot-item">
                    <div>
                        <span class="snapshot-date">${s.date}</span>${i === 0 ? '<span class="latest-badge">latest</span>' : ''}
                        <div class="snapshot-stats">${s.commits} коммитов • ${s.authors} авторов</div>
                    </div>
                    <a href="snapshots/${s.date}.html" class="snapshot-link">Открыть</a>
                </li>`).join('\n')}
            </ul>
        </div>
        ${snapshots.length >= 2 ? `
        <div class="card compare-section">
            <h2>Сравнить слепки</h2>
            <div class="compare-row">
                <select class="compare-select" id="compare-from">
${snapshots.map(s => `                    <option value="${s.date}">${s.date} (${s.commits} коммитов)</option>`).join('\n')}
                </select>
                <span>→</span>
                <select class="compare-select" id="compare-to">
${snapshots.map((s, i) => `                    <option value="${s.date}"${i === 0 ? ' selected' : ''}>${s.date} (${s.commits} коммитов)</option>`).join('\n')}
                </select>
                <button class="compare-btn" onclick="compare()">Сравнить</button>
            </div>
        </div>
        <script>
            function compare() {
                const from = document.getElementById('compare-from').value;
                const to = document.getElementById('compare-to').value;
                if (from === to) { alert('Выберите разные слепки'); return; }
                window.location.href = 'compare.html?from=' + from + '&to=' + to;
            }
        </script>
        ` : ''}
    </div>
</body>
</html>`;
}

// Save snapshot
const snapshotsDir = path.join(OUTPUT_DIR, 'reports', 'snapshots');
const snapshotFile = path.join(snapshotsDir, `${TODAY}.html`);
const manifestFile = path.join(snapshotsDir, 'manifest.json');
const mainPageFile = path.join(OUTPUT_DIR, 'reports', 'git-history.html');

// Ensure directories exist
if (!fs.existsSync(snapshotsDir)) {
  fs.mkdirSync(snapshotsDir, { recursive: true });
}

// Load or create manifest
let manifest = [];
if (fs.existsSync(manifestFile)) {
  manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
}

// Save snapshot HTML
fs.writeFileSync(snapshotFile, generateSnapshotHtml());
console.log(`✅ Snapshot saved: ${snapshotFile}`);

// Update manifest
const existingIdx = manifest.findIndex(m => m.date === TODAY);
const snapshotMeta = { date: TODAY, commits: stats.total, authors: stats.authors, prs: stats.prs };

if (existingIdx >= 0) {
  manifest[existingIdx] = snapshotMeta;
} else {
  manifest.unshift(snapshotMeta);
}

// Sort by date descending
manifest.sort((a, b) => b.date.localeCompare(a.date));

fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`✅ Manifest updated: ${manifest.length} snapshots`);

// Generate main page
fs.writeFileSync(mainPageFile, generateMainPage(manifest));
console.log(`✅ Main page updated: ${mainPageFile}`);

// Also save a copy for local preview
const localFile = `git-report-${TODAY.replace(/-/g, '')}.html`;
fs.writeFileSync(localFile, generateSnapshotHtml());
console.log(`✅ Local copy: ${localFile}`);

try {
  execSync(`open ${localFile}`);
} catch (e) {
  console.log(`📁 Open manually: ${localFile}`);
}
