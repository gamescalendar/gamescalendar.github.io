function parseDateString(inputStr) {
  // 定义季度对应的月份
  const quarterMap = {
    'Q1': '03-31',
    'Q2': '06-30',
    'Q3': '09-30',
    'Q4': '12-31'
  };

  // 预处理字符串，去除多余空格并转换为大写
  const processedStr = inputStr.trim().toUpperCase().replace('-', '');

  // 1. 尝试解析年份和季度 (Q12024, 2024Q1)
  const quarterMatch = processedStr.match(/Q\d/);
  if (quarterMatch) {
    const quarter = quarterMatch[0];
    const year = processedStr.replace(quarter, '');
    if (year.length === 4 && !isNaN(parseInt(year)) && quarterMap[quarter]) {
      return `${year}-${quarterMap[quarter]}`;
    }
  }

  // 2. 尝试解析纯年份 (2025)
  if (processedStr.length === 4 && !isNaN(parseInt(processedStr))) {
    return `${processedStr}-12-31`;
  }
  
  // 3. 尝试解析为标准日期 (2025-05-20)
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