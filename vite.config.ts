import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    watch: {
      ignored: [
        // footprint 下的压缩包可能正在被其它进程写入，监听会触发 EBUSY 并让开发服务器崩溃。
        '**/*.zip',
        '**/*.7z',
        '**/*.rar',
        '**/*.tar',
        '**/*.gz',
        // 模型库（7238 个 STEP）整树不监听：`import.meta.glob` 的索引只在 dev 启动/构建时
        // 建立一次，而批量写入（CLI 铺库、或网页端导入整库压缩包）会让 Vite 为每个文件
        // 逐条触发 glob 失效 → HMR/整页 reload 风暴，最终把 dev server 打死并在日志里留下
        // `hmr update /src/App.tsx, /src/StepModelPicker.tsx, /src/PcbViewer.tsx (xN)`。
        // 症状是页面再也拿不到稳定的模型索引，STEP 选择器没有分类导航。
        // 代价：新增/删除模型不再自动刷新，需重启 `npm run dev` 生效（原本也要求重启）。
        '**/footprint/3dmodels/**',
      ],
    },
    proxy: {
      '/api/kingdee': 'http://127.0.0.1:8765',
      '/api/footprint': 'http://127.0.0.1:8765',
    },
  },
})
