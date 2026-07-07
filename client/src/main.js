import { createApp } from 'vue';
import { createPinia } from 'pinia';
// ElementPlus 通过 vite.config.js 的 unplugin-vue-components 按需引入，不在此处全量导入
// 但程序化调用的 API（ElMessage/ElNotification/ElLoading/ElMessageBox）不在模板中，
// unplugin 无法自动加载其 CSS，需显式导入
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/notification/style/css';
import 'element-plus/es/components/loading/style/css';
import 'element-plus/es/components/message-box/style/css';
// locale 中文配置在 App.vue 中通过 <el-config-provider> 提供
import './styles/theme.css';
import './styles/global.css';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Avatar,
  Calendar,
  Check,
  CircleCheck,
  CircleCheckFilled,
  Clock,
  Collection,
  DataAnalysis,
  DataLine,
  Delete,
  Document,
  DocumentChecked,
  Download,
  Edit,
  EditPen,
  Expand,
  Files,
  Fold,
  Grid,
  Histogram,
  HomeFilled,
  InfoFilled,
  Lightning,
  Loading,
  MagicStick,
  Notebook,
  OfficeBuilding,
  Plus,
  Rank,
  Reading,
  Refresh,
  RefreshRight,
  School,
  Search,
  Setting,
  SetUp,
  SwitchButton,
  Tools,
  Upload,
  User,
  UserFilled,
  Warning,
  WarningFilled,
} from '@element-plus/icons-vue';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';

const app = createApp(App);

// 全局错误边界：捕获组件内未处理的错误，防止整个应用崩溃
app.config.errorHandler = (err, instance, info) => {
  if (import.meta.env.DEV) console.error('[Vue Error]', info, err);
};

app.config.warnHandler = (msg, instance, trace) => {
  if (import.meta.env.DEV) {
    console.warn('[Vue Warn]', msg, trace);
  }
};

// 全局未捕获的 Promise rejection
window.addEventListener('unhandledrejection', (event) => {
  if (import.meta.env.DEV) {
    console.error('[Unhandled Rejection]', event.reason);
  }
});

// 全局同步错误
window.addEventListener('error', (event) => {
  if (import.meta.env.DEV) {
    console.error('[Global Error]', event.message);
  }
});

const pinia = createPinia();
app.use(pinia);
app.use(router);

// 注册实际使用的图标（47个），替代全量注册（280+个）
// ElementPlus 组件本身通过 unplugin-vue-components 按需引入
const icons = {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Avatar,
  Calendar,
  Check,
  CircleCheck,
  CircleCheckFilled,
  Clock,
  Collection,
  DataAnalysis,
  DataLine,
  Delete,
  Document,
  DocumentChecked,
  Download,
  Edit,
  EditPen,
  Expand,
  Files,
  Fold,
  Grid,
  Histogram,
  HomeFilled,
  InfoFilled,
  Lightning,
  Loading,
  MagicStick,
  Notebook,
  OfficeBuilding,
  Plus,
  Rank,
  Reading,
  Refresh,
  RefreshRight,
  School,
  Search,
  Setting,
  SetUp,
  SwitchButton,
  Tools,
  Upload,
  User,
  UserFilled,
  Warning,
  WarningFilled,
};
for (const [key, component] of Object.entries(icons)) {
  app.component(key, component);
}

const authStore = useAuthStore();
// initAuth 涉及网络请求（fetchUserInfo / refreshAccessToken），路由守卫依赖 token 状态，
// 故保持 await 再挂载，避免挂载后守卫读到未初始化的认证状态导致误跳登录页
(async () => {
  await authStore.initAuth();
  app.mount('#app');
})();
