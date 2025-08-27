function parseDateString(inputStr) {
  const quarterMap = {
    'Q1': '03-31',
    'Q2': '06-30',
    'Q3': '09-30',
    'Q4': '12-31'
  };

  let upperStr = inputStr.toUpperCase();
  let foundYear = null;
  let foundQuarter = null;

  // 替换季度
  for (const qKey in quarterMap) {
    if (upperStr.includes(qKey)) {
      foundQuarter = qKey;
      upperStr = upperStr.replaceAll(qKey, "").trim()
      break;
    }
  }

  // 查找年份
  const yearMatch = upperStr.match(/\d{4}/);
  if (yearMatch) {
    foundYear = yearMatch[0];
  }

  // 季度+年份
  if (foundYear && foundQuarter) {
    return `${foundYear}-${quarterMap[foundQuarter]}`;
  }
  
  // 有且仅有年份
  const yearGroups = upperStr.match(/\d+/g)
  if (foundYear && yearGroups.length === 1 && yearGroups[0].length === 4) {
    return `${yearGroups[0]}-12-31`;
  }
  
  // 没有找到年份和季度，尝试解析为标准日期
  const date = new Date(inputStr);
  if (!isNaN(date.getTime())) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  
  // 其他情况，返回三年后
  const now = new Date();
  const futureYear = now.getFullYear() + 3;
  return `${futureYear}-01-01`;
}

import assert from 'assert';
assert.strictEqual(parseDateString('2025'), '2025-12-31', 'Test Case 1 Failed: Pure Year');
assert.strictEqual(parseDateString('2025年'), '2025-12-31', 'Test Case 2 Failed: Year with nan');

assert.strictEqual(parseDateString('Q12024'), '2024-03-31', 'Test Case 3 Failed: Quarter and Year without space');
assert.strictEqual(parseDateString('Q1 2024'), '2024-03-31', 'Test Case 4 Failed: Quarter and Year with space');
assert.strictEqual(parseDateString('Q1-2024'), '2024-03-31', 'Test Case 5 Failed: Quarter and Year with dash');
assert.strictEqual(parseDateString('2025 Q3'), '2025-09-30', 'Test Case 6 Failed: Year and Quarter with space');

assert.strictEqual(parseDateString('2025-05-20'), '2025-05-20', 'Test Case 7 Failed: Standard Date');
assert.strictEqual(parseDateString('invalid input'), '2028-01-01', 'Test Case 8 Failed: Invalid Input')
assert.strictEqual(parseDateString('2024到2025年'), '2028-01-01', 'Test Case 9 Failed: multiple years');
