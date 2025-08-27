const fs = require('fs');
const path = require('path');

/**
 * 读取一个JSON文件，将其内容解析后，以最小化格式（无空格和换行）写入另一个新文件。
 * 输出文件名会自动根据输入文件名生成：输入为 'x.json'，则输出为 'x.min.json'。
 * @param {string} inputFilePath 输入的JSON文件路径。
 */
function minifyJsonFile(inputFilePath) {
  try {
    // 1. 检查命令行参数是否提供
    if (!inputFilePath) {
      console.error('错误: 请提供一个JSON文件路径作为参数。');
      console.error('用法: node your_script_name.js input.json');
      return;
    }

    // 2. 根据输入文件路径生成输出文件路径
    const fileExtension = path.extname(inputFilePath);
    const fileName = path.basename(inputFilePath, fileExtension);
    const outputFilePath = path.join(path.dirname(inputFilePath), `${fileName}.min${fileExtension}`);

    // 3. 同步读取JSON文件
    const jsonData = fs.readFileSync(inputFilePath, 'utf8');

    // 4. 解析JSON字符串为JavaScript对象
    const jsonObject = JSON.parse(jsonData);

    // 5. 将JavaScript对象转换回JSON字符串，并以最小化格式输出
    const minifiedJson = JSON.stringify(jsonObject);

    // 6. 将最小化后的JSON字符串写入新文件
    fs.writeFileSync(outputFilePath, minifiedJson, 'utf8');

    console.log(`成功将文件 ${inputFilePath} 最小化并输出到 ${outputFilePath}`);

  } catch (error) {
    // 7. 错误处理
    if (error.code === 'ENOENT') {
        console.error(`错误: 文件不存在或路径不正确 - ${inputFilePath}`);
    } else {
        console.error('处理文件时发生错误:', error.message);
    }
  }
}

// --- 使用示例 ---
// 从命令行参数中获取输入文件路径
const inputPath = process.argv[2];

// 调用函数处理文件
minifyJsonFile(inputPath);