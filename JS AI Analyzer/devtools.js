// 创建一个新面板
chrome.devtools.panels.create(
    "JS分析",
    null,
    "panel.html",
    function(panel) {
        console.log("面板创建成功");
    }
); 