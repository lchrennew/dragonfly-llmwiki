import { debug } from './debug.js'

debug.print('这是一条调试信息')

debug.print('多个参数:', 123, true, { key: 'value' })

debug.print('对象会被格式化:', {
  name: 'test',
  data: [1, 2, 3],
  nested: { a: 1, b: 2 }
})
