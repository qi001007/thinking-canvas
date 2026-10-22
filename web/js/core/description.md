# web/js/core 目录说明

纯数据层，禁止访问 DOM。`model.js` 项目对象/状态/指针/校验；`steps.js` 快照与时间线数据；`diff.js` 相邻快照差异；`history.js` 撤销重做；`geometry.js` 卡片尺寸/锚点/吸附/视口；`serialize.js` JSON 往返与文件名；`parse.js` 批量输入与剪贴板解析；`sample.js` 可选示例画板。Node 测试直接导入这些模块。
