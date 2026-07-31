// 密码强度校验器：全站统一口径（与后端保持一致）
// 规则：长度 8-128 位，至少包含两种字符类型（小写字母、大写字母、数字、特殊字符）

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

// 至少包含两种字符类型的校验器（Element Plus rule validator 签名）
function passwordComplexityValidator(rule, value, callback) {
  if (!value) return callback();
  let types = 0;
  if (/[a-z]/.test(value)) types++;
  if (/[A-Z]/.test(value)) types++;
  if (/\d/.test(value)) types++;
  if (/[^a-zA-Z\d]/.test(value)) types++;
  if (types < 2) {
    callback(new Error('密码须至少包含两种字符类型（小写字母、大写字母、数字、特殊字符中的两种）'));
  } else {
    callback();
  }
}

// 返回一份新密码字段的 rules 数组（避免多组件共享同一数组引用）
export function createPasswordRules({ required = true } = {}) {
  const rules = [];
  if (required) {
    rules.push({ required: true, message: '请输入新密码', trigger: 'blur' });
  }
  rules.push(
    {
      min: PASSWORD_MIN,
      max: PASSWORD_MAX,
      message: `密码长度必须在${PASSWORD_MIN}-${PASSWORD_MAX}位之间`,
      trigger: 'blur',
    },
    { validator: passwordComplexityValidator, trigger: 'blur' }
  );
  return rules;
}

// 生成确认密码字段的校验器：比对目标密码取值
export function createConfirmPasswordValidator(getPassword) {
  return (rule, value, callback) => {
    if (value !== getPassword()) {
      callback(new Error('两次输入的密码不一致'));
    } else {
      callback();
    }
  };
}

export { passwordComplexityValidator, PASSWORD_MIN, PASSWORD_MAX };
