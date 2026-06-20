import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/global.css'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import {
  ArrowDown, ArrowRight, ArrowUp, Calendar, Check, CircleCheck,
  CircleCheckFilled, Collection, DataAnalysis, Delete, Document,
  DocumentChecked, Download, Edit, Expand, Fold, Grid, HomeFilled, InfoFilled,
  Loading, MagicStick, Notebook, OfficeBuilding, Plus, Rank,
  Reading, Refresh, RefreshRight, Setting, SetUp, Tools, User,
  UserFilled, Warning, WarningFilled,
} from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

// 全局错误边界：捕获组件内未处理的错误，防止整个应用崩溃
app.config.errorHandler = (err, instance, info) => {
  if (import.meta.env.DEV) {
    console.error('[Vue Error]', info, err)
  }
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

// 只注册实际使用的图标（36个），替代全量注册（280+个）
const icons = {
  ArrowDown, ArrowRight, ArrowUp, Calendar, Check, CircleCheck,
  CircleCheckFilled, Collection, DataAnalysis, Delete, Document,
  DocumentChecked, Download, Edit, Expand, Fold, Grid, HomeFilled, InfoFilled,
  Loading, MagicStick, Notebook, OfficeBuilding, Plus, Rank,
  Reading, Refresh, RefreshRight, Setting, SetUp, Tools, User,
  UserFilled, Warning, WarningFilled,
}
for (const [key, component] of Object.entries(icons)) {
  app.component(key, component)
}

const authStore = useAuthStore()
await authStore.initAuth()

app.mount('#app')
