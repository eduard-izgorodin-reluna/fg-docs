# FG Documentation

Static documentation site for Reluna Family Governance Platform.

## Live Site

https://eduard-izgorodin-reluna.github.io/fg-docs/

## Contents

- **Git History Report** — Interactive visualization of git commits with branch graph

## Update Report

```bash
./update-report.sh all    # Full history
./update-report.sh 4      # Last 4 weeks

git add . && git commit -m "docs: update report" && git push
```

## Structure

```
fg-docs/
├── index.html              # Landing page
├── update-report.sh        # Update script
├── generate-git-report.js  # Generator (reference)
└── reports/
    └── git-history.html    # Git history visualization
```
