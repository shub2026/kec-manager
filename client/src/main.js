import { createApp } from 'vue';
import { createPinia } from 'pinia';
// ElementPlus 通过 vite.config.js 的 unplugin-vue-components 按需引入，不在此处全量导入
// locale 中文配置在 App.vue 中通过 <el-config-provider> 提供
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
(async () => {
  await authStore.initAuth();
  app.mount('#app');
})();
