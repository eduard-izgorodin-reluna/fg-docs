#!/bin/bash

# Update Git History Report
# Usage: ./update-report.sh [weeks|all]
#
# Examples:
#   ./update-report.sh        # Last 3 weeks (default)
#   ./update-report.sh 6      # Last 6 weeks
#   ./update-report.sh all    # Full history

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FG_REPO="${FG_REPO_PATH:-$SCRIPT_DIR/../projects/FG/turbo}"

# Check if FG repo exists
if [ ! -d "$FG_REPO/.git" ]; then
    echo "❌ FG repository not found at: $FG_REPO"
    echo "   Set FG_REPO_PATH environment variable or run from correct location"
    exit 1
fi

PERIOD="${1:-3}"

echo "📊 Updating Git History Report..."
echo "   FG repo: $FG_REPO"
echo "   Period: ${PERIOD} $([ "$PERIOD" = "all" ] && echo "(full history)" || echo "weeks")"

# Generate report in FG repo
cd "$FG_REPO"
node generate-git-report.js "$PERIOD"

# Find the generated file
REPORT_FILE=$(ls -t git-report-*.html 2>/dev/null | head -1)

if [ -z "$REPORT_FILE" ]; then
    echo "❌ Report file not generated"
    exit 1
fi

# Copy to fg-docs
cp "$REPORT_FILE" "$SCRIPT_DIR/reports/git-history.html"
echo "✅ Report copied to fg-docs/reports/git-history.html"

# Update commit count in index.html
COMMIT_COUNT=$(grep -oP '\d+(?=</div><div class="label">коммитов)' "$SCRIPT_DIR/reports/git-history.html" || echo "")
if [ -n "$COMMIT_COUNT" ]; then
    sed -i '' "s/([0-9]* commits)/(${COMMIT_COUNT} commits)/" "$SCRIPT_DIR/index.html" 2>/dev/null || true
    echo "✅ Updated commit count in index.html: $COMMIT_COUNT"
fi

# Update date in index.html
TODAY=$(date '+%B %d, %Y')
sed -i '' "s/Last updated: .*/Last updated: $TODAY<\/p>/" "$SCRIPT_DIR/index.html" 2>/dev/null || true

# Clean up generated file in FG repo
rm -f "$FG_REPO/$REPORT_FILE"

cd "$SCRIPT_DIR"

echo ""
echo "📋 Next steps:"
echo "   cd $SCRIPT_DIR"
echo "   git add . && git commit -m 'docs: update report' && git push"
echo ""
echo "🌐 Site: https://eduard-izgorodin-reluna.github.io/fg-docs/"
