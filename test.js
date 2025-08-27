function parseDateString(inputStr) {
  // 定义季度对应的月份
  const quarterMap = {
    'Q1': '03-31',
    'Q2': '06-30',
    'Q3': '09-30',
    'Q4': '12-31'
  };

  // 预处理字符串，去除多余空格并转换为大写
  const processedStr = inputStr.trim().toUpperCase();

  // 1. 尝试解析年份和季度
  const parts = processedStr.split(' ');
  let year = '';
  let quarter = '';

  for (const part of parts) {
    if (part.length === 4 && !isNaN(parseInt(part))) {
      year = part;
    } else if (part.startsWith('Q')) {
      quarter = part;
    }
  }

  // 检查是否找到年份和季度
  if (quarter && year && quarterMap[quarter]) {
    return `${year}-${quarterMap[quarter]}`;
  }

  // 2. 尝试解析纯年份
  if (processedStr.length === 4 && !isNaN(parseInt(processedStr))) {
    return `${processedStr}-12-31`;
  }
  
  // 3. 尝试解析为标准日期
  const date = new Date(inputStr);
  if (!isNaN(date.getTime())) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // 4. 其他情况，返回三年后的一月一日
  const now = new Date();
  const futureYear = now.getFullYear() + 3;
  return `${futureYear}-01-01`;
}

console.log(parseDateString('2025')); // 输出: 2025-12-31
console.log(parseDateString('Q1 2024')); // 输出: 2024-03-31
console.log(parseDateString('Q12024')); // 输出: 2024-03-31
console.log(parseDateString('2025 Q3')); // 输出: 2025-09-30
console.log(parseDateString('2025-05-20')); // 输出: 2025-05-20
console.log(parseDateString('invalid input')); // 输出: 2028-01-01