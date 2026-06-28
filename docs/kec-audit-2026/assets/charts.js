(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart 1: Severity Distribution Pie ---
  var chart1 = echarts.init(document.getElementById('chart-severity'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: muted } },
    color: ['#dc2626', '#ea580c', '#eab308', '#2563eb'],
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '45%'],
      label: { show: true, color: ink, formatter: '{b}\n{d}%' },
      emphasis: { disabled: true },
      data: [
        { value: 2, name: '严重 (Critical)' },
        { value: 7, name: '高危 (High)' },
        { value: 16, name: '中危 (Medium)' },
        { value: 35, name: '低危 (Low)' }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart 2: Category Distribution Bar ---
  var chart2 = echarts.init(document.getElementById('chart-category'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true },
    legend: { bottom: 0, textStyle: { color: muted } },
    color: ['#dc2626', '#ea580c', '#eab308', '#2563eb'],
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['安全漏洞', '业务逻辑', '前端安全', '数据联动', '导入导出'],
      axisLabel: { color: muted, rotate: 15 }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [
      { name: '严重', type: 'bar', stack: 'total', data: [0, 2, 0, 0, 0] },
      { name: '高危', type: 'bar', stack: 'total', data: [2, 3, 0, 2, 0] },
      { name: '中危', type: 'bar', stack: 'total', data: [5, 4, 5, 2, 0] },
      { name: '低危', type: 'bar', stack: 'total', data: [3, 6, 18, 2, 6] }
    ]
  });
  window.addEventListener('resize', function() { chart2.resize(); });

  // --- Chart 3: Fix Priority Timeline ---
  var chart3 = echarts.init(document.getElementById('chart-priority'), null, { renderer: 'svg' });
  chart3.setOption({
    animation: false,
    tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c}项' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['P0\n(立即修复)', 'P1\n(本周)', 'P2\n(本月)', 'P3\n(本季度)', 'P4\n(择期)'],
      axisLabel: { color: muted }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'bar',
      data: [
        { value: 2, itemStyle: { color: '#dc2626' } },
        { value: 5, itemStyle: { color: '#ea580c' } },
        { value: 8, itemStyle: { color: '#eab308' } },
        { value: 10, itemStyle: { color: '#2563eb' } },
        { value: 35, itemStyle: { color: muted } }
      ],
      barWidth: '50%',
      label: { show: true, position: 'top', color: ink, fontWeight: 600 }
    }]
  });
  window.addEventListener('resize', function() { chart3.resize(); });
})();