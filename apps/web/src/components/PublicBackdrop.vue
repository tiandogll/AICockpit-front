<template>
  <svg
    class="public-backdrop"
    viewBox="0 0 1586 992"
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <radialGradient id="public-ice">
        <stop stop-color="#d6f6fc" stop-opacity=".82" />
        <stop offset="1" stop-color="#f7fcfe" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="public-ribbon" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#fff" stop-opacity=".9" />
        <stop offset=".6" stop-color="#fff" stop-opacity=".2" />
        <stop offset="1" stop-color="#fff" stop-opacity=".8" />
      </linearGradient>
    </defs>
    <rect width="1586" height="992" fill="#f6fcfe" />
    <ellipse cx="80" cy="565" rx="440" ry="730" fill="url(#public-ice)" />
    <ellipse cx="1400" cy="790" rx="620" ry="550" fill="url(#public-ice)" />
    <g fill="url(#public-ribbon)">
      <path
        d="M40 0C159 234 495 398 773 549C1175 769 1479 706 1586 479V604C1337 990 904 844 605 673C242 465 81 327 0 211V0Z"
      />
      <path d="M0 583C460 823 818 1062 1586 473V488C1020 1058 442 927 0 655Z" />
      <path d="M0 702C530 1055 1290 958 1586 710V754C1248 1046 599 1097 0 708Z" />
      <path d="M0 904C99 924 189 964 219 992H284C227 899 122 804 0 775Z" opacity=".6" />
    </g>
    <g fill="none" stroke="#fff" stroke-width="1.4" opacity=".9">
      <path d="M0 650Q495 826 774 992" />
      <path d="M0 705C546 1062 1281 956 1586 715" />
      <path d="M0 250Q309 667 878 847" />
    </g>
    <g fill="none" stroke="#9ee3f3" stroke-width=".65" opacity=".8">
      <path d="M872 219C968 57 1323 40 1462 197" stroke-dasharray="2 4" />
      <path d="M0 805Q49 897 177 956" />
      <path d="M1440 986Q1538 936 1586 885" />
    </g>
    <g fill="#5ad0e9" stroke="#fff" stroke-width="1">
      <circle cx="60" cy="883" r="6" />
      <circle cx="1336" cy="149" r="6" />
      <circle cx="1108" cy="109" r="3" />
      <circle cx="1382" cy="994" r="6" />
    </g>
  </svg>
</template>
<style scoped>
.public-backdrop {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100vh;
  z-index: -1;
  pointer-events: none;
}
</style>
