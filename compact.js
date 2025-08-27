const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Set the script to exit immediately if any command fails
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Define the regular expression for daily update commit messages
const DAILY_UPDATE_PATTERN = /^squash! Daily update/;
const SQUASH_LIMIT = 200; // 设置一次性合并的提交上限

/**
 * Finds and squashes the most recent contiguous sequence of "Daily update" commits.
 * @returns {boolean} Returns true if a sequence was found and processed, false otherwise.
 */
async function runOnce() {
    try {
        // --- Script setup and preparation ---

        // 获取命令行参数，第一个参数是目标分支名，如果没有则默认为 'release'
        const TARGET_BRANCH = process.argv[2] || 'release';

        // Check if the working directory is clean to avoid unexpected issues during rebase
        console.log('正在检查工作区状态...');
        if (execSync('git status --porcelain').toString().trim().length > 0) {
            console.error("错误：工作区不干净，请先提交或暂存你的修改。");
            return false;
        }
        console.log('工作区干净。');

        // Switch to the target branch if not already on it
        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
        if (currentBranch !== TARGET_BRANCH) {
            console.log(`注意：当前分支不是 '${currentBranch}'，正在切换到 '${TARGET_BRANCH}' 分支...`);
            execSync(`git checkout ${TARGET_BRANCH}`);
        } else {
            console.log(`已在目标分支 '${TARGET_BRANCH}' 上。`);
        }

        // --- Fetch and parse the complete commit history ---

        console.log(`正在获取 '${TARGET_BRANCH}' 分支的完整提交历史并构建数组...`);
        // Use a single git log command to get the hash and message for all commits
        const logOutput = execSync('git log --pretty=format:"%H|%s|%as"').toString().trim();
        if (!logOutput) {
            console.log("Git 仓库没有提交记录。");
            return false;
        }

        // Split the output into individual commit objects
        const allCommits = logOutput.split('\n').map(line => {
            const [hash, message, authDate] = line.split('|');
            return { hash, message, authDate };
        });

        // --- Find the contiguous commit sequence ---
        
        let startIndex = -1;
        let endIndex = -1;
        let foundSequence = false;
        
        // Iterate through all commits to find the first sequence from the newest to oldest commit
        for (let i = 0; i < allCommits.length; i++) {
            const commit = allCommits[i];
            
            if (DAILY_UPDATE_PATTERN.test(commit.message)) {
                // If this is a matching commit, it's a potential part of a sequence
                if (startIndex === -1) {
                    startIndex = i;
                }
                endIndex = i;
            } else {
                // If we encounter a non-matching commit, check if we've found a valid sequence
                if (startIndex !== -1 && (endIndex - startIndex) >= 1) {
                    foundSequence = true;
                    break;
                }
                // Reset indices for the next search
                startIndex = -1;
                endIndex = -1;
            }
        }

        // Check for a sequence that extends to the very beginning of the history
        if (startIndex !== -1 && (endIndex - startIndex) >= 1) {
            foundSequence = true;
        }

        // Ensure that a valid sequence was found (at least two commits)
        if (!foundSequence) {
            console.log("没有找到连续的每日更新提交序列（至少需要两个提交）。");
            return false;
        }
        
        // Correct the indices to be in chronological order
        const oldestCommitIndex = endIndex;
        const newestCommitIndex = startIndex;
        
        // Apply the squash limit if the sequence is too long
        let squashingCount = oldestCommitIndex-newestCommitIndex+1;
        const reachedLimit = squashingCount > SQUASH_LIMIT;
        if (reachedLimit) {
            // Adjust the number of commits to squash to the limit
            squashingCount = SQUASH_LIMIT;
        }
        const effectiveOldestIndex = newestCommitIndex + squashingCount - 1;

        const startCommit = allCommits[effectiveOldestIndex];
        const endCommit = allCommits[newestCommitIndex];
        
        // Extract start and end dates from the commit messages
        const startDate = startCommit.authDate || 'Unknown Date';
        const endDate = endCommit.authDate || 'Unknown Date';

        console.log(`找到一个包含 ${squashingCount} 个提交的连续序列，从 ${startDate} (${oldestCommitIndex}) 到 ${endDate} (${newestCommitIndex})。`);
        console.log("将要合并的提交：");
        for (let i = newestCommitIndex; i <= effectiveOldestIndex; i++) {
            const commit = allCommits[i];
            console.log(`  - ${commit.hash.substring(0, 7)}: ${commit.message}`);
        }
        console.log("正在将这些提交合并为一个...");

        // The rebase base is the commit *before* the first commit in the sequence we want to squash.
        const rebaseBase = (effectiveOldestIndex + 1 < allCommits.length)
            ? allCommits[effectiveOldestIndex + 1].hash
            : 'HEAD~' + squashingCount;

        // --- Execute automated git rebase ---

        // 1. Get the hashes of the commits to be squashed (excluding the oldest commit which will be the 'pick').
        // The rebase todo list is newest to oldest. So we take all but the last commit in our slice.
        const commitsToSquash = allCommits.slice(newestCommitIndex, effectiveOldestIndex).map(c => c.hash);

        // 2. Create the GIT_SEQUENCE_EDITOR script using Node.js to handle the todo list
        const gitSequenceEditorPath = path.join('/tmp', `git_sequence_editor_${Date.now()}.js`);
        
        const editorScriptContent = `#!/usr/bin/env node
const fs = require('fs');

const todoFilePath = process.argv[2];
// We use abbreviated hashes for the Set lookup.
const hashesToSquash = new Set(${JSON.stringify(commitsToSquash.map(hash => hash.substring(0, 7)))});

try {
    const todoContent = fs.readFileSync(todoFilePath, 'utf-8');
    const lines = todoContent.split('\\n');
    
    const newLines = lines.map(line => {
        const parts = line.trim().split(' ');
        if (parts[0] === 'pick' && hashesToSquash.has(parts[1])) {
            return \`squash \${parts[1]} \${parts.slice(2).join(' ')}\`;
        }
        return line;
    });
    
    fs.writeFileSync(todoFilePath, newLines.join('\\n'));
} catch (error) {
    console.error('Error in Git sequence editor:', error.message);
    process.exit(1);
}
`;
        fs.writeFileSync(gitSequenceEditorPath, editorScriptContent, { mode: 0o755 });

        // 3. Create a temporary commit message file for the rebase.
        const gitEditorPath = path.join('/tmp', `git_editor_${Date.now()}`);
        const newCommitMessage = reachedLimit
            ? `squash! Daily update`
            : `Compacted: Daily update from ${startDate} to ${endDate}`;
        fs.writeFileSync(gitEditorPath, `#!/bin/bash\necho "${newCommitMessage}" > "$1"`, { mode: 0o755 });

        // 4. Prepare the git rebase command and arguments
        const gitArgs = ['rebase', '-i', '--committer-date-is-author-date', rebaseBase];
        console.log(`即将执行命令: git ${gitArgs.join(' ')}`);

        // 5. Execute the rebase process with our custom Node.js editor and pass the hashes as arguments
        const rebaseProcess = spawn('git', gitArgs, {
            stdio: 'inherit',
            env: {
                ...process.env,
                GIT_SEQUENCE_EDITOR: `${gitSequenceEditorPath}`,
                GIT_EDITOR: gitEditorPath,
            }
        });

        // 6. Wait for the rebase process to finish and clean up.
        return new Promise((resolve, reject) => {
            rebaseProcess.on('close', (code) => {
                fs.unlinkSync(gitSequenceEditorPath);
                fs.unlinkSync(gitEditorPath);
                
                if (code === 0) {
                    console.log("✅ 成功：连续的每日更新提交已合并并压缩。");
                    console.log(`新提交信息：'${newCommitMessage}'`);
                    resolve(true); // Indicate success and that a sequence was processed
                } else {
                    console.error(`❌ 错误：Git rebase 进程以非零退出代码 ${code} 结束。请手动解决冲突。`);
                    resolve(false); // Indicate failure
                }
            });
        });

    } catch (error) {
        console.error("执行脚本时发生错误：", error.message);
        console.error("请确保你的 Git 仓库有效且所有命令都已正确执行。");
        return false;
    }
}

// Main execution loop
(async () => {
    let result = true;
    while (result) {
        console.log("\n--- 正在开始新一轮的每日更新提交合并 ---");
        result = await runOnce();
        if (result) {
            // Add a small delay for readability between loops
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    console.log("\n所有连续的每日更新提交序列已合并，脚本已完成。");
})();
