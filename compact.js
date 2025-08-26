const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 设置在任何命令失败时立即退出脚本
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

const BRANCH = "compact"
// 定义每日更新提交信息的正则表达式
const DAILY_UPDATE_PATTERN = /^Daily update at/;

async function runScript() {
    try {
        // --- 脚本配置和准备 ---

        // 检查工作区是否干净，避免 rebase 过程中出现意外
        console.log('正在检查工作区状态...');
        if (execSync('git status --porcelain').toString().trim().length > 0) {
            console.error("错误：工作区不干净，请先提交或暂存你的修改。");
            return;
        }
        console.log('工作区干净。');

        // 切换到 release 分支，如果当前不在该分支上
        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
        if (currentBranch !== BRANCH) {
            console.log(`注意：当前分支不是 '${currentBranch}'，正在切换到 '${BRANCH}' 分支...`);
            execSync(`git checkout ${BRANCH}`);
        }

        // --- 获取并解析完整的提交历史 ---

        console.log("正在获取完整的提交历史并构建数组...");
        // 使用一个 git log 命令获取所有提交的哈希和信息
        const logOutput = execSync('git log --pretty=format:"%H|%s"').toString().trim();
        if (!logOutput) {
            console.log("Git 仓库没有提交记录。");
            return;
        }
        
        // 将输出的每一行分割成单独的提交对象
        const allCommits = logOutput.split('\n').map(line => {
            const [hash, message] = line.split('|');
            return { hash, message };
        });

        // --- 查找连续的提交序列 ---

        let startCommitIndex = -1;
        let endCommitIndex = -1;
        let foundSequence = false;

        // 从最近的提交开始向后遍历，寻找第一个连续序列
        for (let i = 0; i < allCommits.length; i++) {
            const commit = allCommits[i];
            
            if (DAILY_UPDATE_PATTERN.test(commit.message)) {
                // 如果这是第一个匹配的提交，我们开始一个新序列
                if (startCommitIndex === -1) {
                    endCommitIndex = i;
                    startCommitIndex = i;
                } else {
                    // 如果前一个提交也是每日更新，则扩展当前序列
                    startCommitIndex = i;
                }
            } else {
                // 如果当前提交不匹配，并且我们已经找到了一个序列
                if (startCommitIndex !== -1 && endCommitIndex !== startCommitIndex) {
                    foundSequence = true;
                    break;
                }
                // 重置索引，准备寻找下一个序列
                startCommitIndex = -1;
                endCommitIndex = -1;
            }
        }
        
        // 确保找到了一个有效的序列（至少两个提交）
        if (!foundSequence || startCommitIndex === endCommitIndex) {
            console.log("没有找到连续的每日更新提交序列（至少需要两个提交）。");
            return;
        }

        const startCommit = allCommits[startCommitIndex];
        const endCommit = allCommits[endCommitIndex];
        const count = endCommitIndex - startCommitIndex + 1;
        
        // 从提交信息中提取开始和结束日期
        const startDate = startCommit.message.match(/\d{4}-\d{2}-\d{2}/)[0];
        const endDate = endCommit.message.match(/\d{4}-\d{2}-\d{2}/)[0];

        console.log(`找到一个包含 ${count} 个提交的连续序列，从 ${startDate} 到 ${endDate}。`);
        console.log("正在将这些提交合并为一个...");

        // 获取 rebase 操作的基准提交哈希
        // 这是我们要合并的序列中第一个提交的父提交
        const rebaseBase = (endCommitIndex + 1 < allCommits.length) 
                           ? allCommits[endCommitIndex + 1].hash 
                           : 'HEAD~' + count; // fallback if it's the beginning of history

        // --- 执行自动化的 git rebase ---

        // 创建临时文件来自动化 git rebase 的交互式编辑
        const gitSequenceEditorPath = path.join('/tmp', `git_sequence_editor_${Date.now()}`);
        const gitEditorPath = path.join('/tmp', `git_editor_${Date.now()}`);

        fs.writeFileSync(gitSequenceEditorPath, `#!/bin/bash\nsed -i '2,$s/^pick/squash/' "$1"`, { mode: 0o755 });
        fs.writeFileSync(gitEditorPath, `#!/bin/bash\necho "Compacted: Daily update from ${startDate} to ${endDate}" > "$1"`, { mode: 0o755 });

        // 使用 spawn 执行 rebase
        const rebaseProcess = spawn('git', ['rebase', '-i', '--committer-date-is-author-date', rebaseBase], {
            stdio: 'inherit',
            env: {
                ...process.env,
                GIT_SEQUENCE_EDITOR: gitSequenceEditorPath,
                GIT_EDITOR: gitEditorPath,
            }
        });

        // 等待 rebase 进程完成
        rebaseProcess.on('close', (code) => {
            // 清理临时文件
            fs.unlinkSync(gitSequenceEditorPath);
            fs.unlinkSync(gitEditorPath);
            
            if (code === 0) {
                console.log("✅ 成功：连续的每日更新提交已合并并压缩。");
                console.log(`新提交信息：'Compacted: Daily update from ${startDate} to ${endDate}'`);
                console.log("你可以再次运行此脚本来合并下一个连续序列。");
            } else {
                console.error(`❌ 错误：Git rebase 进程以非零退出代码 ${code} 结束。请手动解决冲突。`);
            }
        });

    } catch (error) {
        console.error("执行脚本时发生错误：", error.message);
        console.error("请确保你的 Git 仓库有效且所有命令都已正确执行。");
    }
}

runScript();
