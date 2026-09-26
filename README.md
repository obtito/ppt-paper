# braidloss · 结果展示页

竞赛项目的单文件网页总览:高频编织/绞合导线交流损耗仿真(MATLAB × COMSOL 6.2)。

## 使用

- 直接双击 `index.html` 在浏览器打开(无外部依赖,可离线);
- 或本地起服务:`python3 -m http.server -d web 8000` 后访问 http://localhost:8000

## 主题

- 默认**深色**(答辩投屏用),右上角可切换**浅色**(阅读/评审环境);
- 打印时自动强制浅色(`@media print`),主题选择记忆在 localStorage。

## 内容与数据来源

| 页面区块 | 数据来源 |
|---|---|
| KPI / 概览 | `Q1_COMSOL/第一题_COMSOL建模说明.md`、`Q2_*/results_summary.json` |
| 条形图 | 等铜截面四结构 Rac:实心 15.463 / 六角 15.763 / 圆形 14.900 / 绞合 14.401 mΩ/m |
| Q2 设计约束 / 机理 / PEEC | `论文/求解思路.md` 问题二节(β 选型、N=331 推导、不均流机理、PEEC 交叉验证数据) |
| Q3 区块(图+数据) | `未命名文件夹 5/litz_q3/`(final_results.json、topology_control.csv、strand_count_control.csv、figures/)与 `litz_topology_explanation/`;评价指标/三拓扑对比/敏感性按赛题表2与问题三评分项组织 |
| Q4 区块(判据/拓扑/制造) | `Q3实验数据/litz_topology_explanation/完整换位与有限体积可行性说明.md` + `litz_q3` 仿真数据(K=1.497,η_I≈10⁻¹³) |
| Q3+Q4 三维查看器 | `data/q3-braid.js`(484 股换位轨迹系数)+ `q3-viewer.js` + `lib/three.min.js`(r140 UMD,经典 script 保证 file:// 可用) |
| 图片 | `img/*.png` 复制自 `Q1_COMSOL/`、`Q2_Circular_COMSOL/`、`Q2_RegularTwist_COMSOL/`、Q3 figures(COMSOL 原生导出) |

更新数值时改 `index.html` 内对应文本即可;图片替换同名文件。
