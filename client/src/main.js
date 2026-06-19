import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/global.css'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

// 全局错误边界：捕获组件内未处理的错误，防止整个应用崩溃
app.config.errorHandler = (err, instance, info) => {
  if (import.meta.env.DEV) {
    console.error('[Vue Error]', info, err)
  }
  // 生产环境下静默处理，避免信息泄露；可在此接入错误上报服务
}

app.config.warnHandler = (msg, instance, trace) => {
  if (import.meta.env.DEV) {
    console.warn('[Vue Warn]', msg, trace)
  }
}

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus, { locale: zhCn })

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

const authStore = useAuthStore()
await authStore.initAuth()

app.mount('#app')
