(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart 1: 严重程度分布 ---
  var chart1El = document.getElementById('chart-severity');
  if (chart1El) {
    var chart1 = echarts.init(chart1El, null, { renderer: 'svg' });
    chart1.setOption({
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        appendToBody: true,
        backgroundColor: bg2,
        borderColor: rule,
        textStyle: { color: ink },
      },
      grid: { left: 80, right: 30, top: 30, bottom: 40 },
      xAxis: {
        type: 'category',
        data: ['严重', '高危', '中危', '低危'],
        axisLine: { lineStyle: { color: rule } },
        axisLabel: { color: muted, fontSize: 13, fontWeight: 600 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: rule, type: 'dashed' } },
        axisLabel: { color: muted, fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          data: [
            { value: 1, itemStyle: { color: '#d63031' } },
            { value: 7, itemStyle: { color: '#e17055' } },
            { value: 13, itemStyle: { color: '#f39c12' } },
            { value: 11, itemStyle: { color: '#4a9eda' } },
          ],
          barWidth: '52%',
          label: {
            show: true,
            position: 'top',
            color: ink,
            fontSize: 16,
            fontWeight: 700,
          },
          itemStyle: { borderRadius: [6, 6, 0, 0] },
        },
      ],
    });
    window.addEventListener('resize', function () {
      chart1.resize();
    });
  }

  // --- Chart 2: 问题分类分布 ---
  var chart2El = document.getElementById('chart-category');
  if (chart2El) {
    var chart2 = echarts.init(chart2El, null, { renderer: 'svg' });
    chart2.setOption({
      animation: false,
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        backgroundColor: bg2,
        borderColor: rule,
        textStyle: { color: ink },
        formatter: '{b}: {c} 项 ({d}%)',
      },
      legend: {
        bottom: 0,
        textStyle: { color: muted, fontSize: 12 },
        icon: 'circle',
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          data: [
            { value: 5, name: '业务逻辑缺陷', itemStyle: { color: '#d63031' } },
            { value: 4, name: '数据完整性', itemStyle: { color: '#e17055' } },
            { value: 6, name: '输入校验', itemStyle: { color: '#f39c12' } },
            { value: 7, name: '安全防护', itemStyle: { color: '#4a9eda' } },
            { value: 10, name: '健壮性/性能', itemStyle: { color: '#a29bfe' } },
          ],
          itemStyle: { borderColor: bg2, borderWidth: 2 },
        },
      ],
    });
    window.addEventListener('resize', function () {
      chart2.resize();
    });
  }
})();
