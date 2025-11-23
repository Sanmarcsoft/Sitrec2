#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const issues = [];

    lines.forEach((line, index) => {
        if (/from\s+['"]three\/src\//.test(line) || /import\s+['"]three\/src\//.test(line)) {
            issues.push({
                file: filePath,
                line: index + 1,
                content: line.trim()
            });
        }
    });

    return issues;
}

function checkDirectory(dir, issues = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
                continue;
            }
            checkDirectory(fullPath, issues);
        } else if (entry.isFile() && /\.(js|jsx|ts|tsx)$/.test(entry.name)) {
            const fileIssues = checkFile(fullPath);
            issues.push(...fileIssues);
        }
    }

    return issues;
}

const srcDir = path.join(__dirname, '..', 'src');
const issues = checkDirectory(srcDir);

if (issues.length > 0) {
    console.error('\n❌ Found incorrect Three.js imports:\n');
    issues.forEach(issue => {
        console.error(`  ${issue.file}:${issue.line}`);
        console.error(`    ${issue.content}`);
    });
    console.error('\n  Replace "three/src/*" imports with "three" imports.\n');
    process.exit(1);
} else {
    console.log('✅ No incorrect Three.js imports found.');
}
