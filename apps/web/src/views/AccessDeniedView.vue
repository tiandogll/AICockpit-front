<template>
  <section class="permission-page surface">
    <h1>当前账号无法访问此功能</h1>
    <p>
      当前账号在所选空间没有该功能的权限。请联系管理员确认授权；学员仍可继续测评并查看本人的报告。
    </p>
    <RouterLink class="primary-button" to="/workspace">返回工作台</RouterLink>
  </section>
</template>
<style scoped>
.permission-page {
  max-width: 720px;
  margin: 50px auto;
  padding: 32px;
}
.permission-page h1 {
  font-size: 24px;
}
.permission-page p {
  color: var(--muted);
  margin: 18px 0 24px;
}
</style>
