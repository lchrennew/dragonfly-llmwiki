# Debug 工具使用说明

## 概述

`debug.js` 提供了一个调试输出工具，可以在对话界面中显示调试信息。

## 功能特性

- 在对话界面中以"调试"角色显示信息
- 支持多个参数
- 自动格式化对象为 JSON
- 如果 UI 未初始化，会降级到 console.log

## 使用方法

### 1. 导入 debug 工具

```javascript
import { debug } from './debug.js'
```

### 2. 使用 debug.print()

```javascript
debug.print('简单的调试信息')

debug.print('多个参数:', 123, true, 'text')

debug.print('对象会被格式化:', {
  name: 'test',
  data: [1, 2, 3],
  nested: { a: 1, b: 2 }
})
```

## 显示效果

调试信息会在对话界面中以紫色（#bd93f9）显示，前缀为"调试:"。

## 实现细节

- **角色**: 'debug'
- **颜色**: #bd93f9 (紫色)
- **前缀**: "调试: "
- **对象格式化**: JSON.stringify(obj, null, 2)

## 文件结构

- `src/debug.js` - 调试工具实现
- `src/ui.tsx` - UI 界面支持 debug 角色
- `src/app.tsx` - 初始化 debug 工具
- `src/debug-example.js` - 使用示例

## 注意事项

- debug.print() 必须在 UI 初始化后才能正常工作
- 在 UI 初始化前调用会降级到 console.log
- 对象会被自动转换为格式化的 JSON 字符串
