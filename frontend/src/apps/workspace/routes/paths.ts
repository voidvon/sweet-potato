export const routePaths = {
  login: '/login',
  appRoot: '/app',
  defaultLanding: '/app/discover',
  defaultModule: '/app/image',
  discover: '/app/discover',
  module: (moduleId = ':moduleId') => `/app/modules/${moduleId}`,
  contentRoot: '/app/content',
  contentDefault: '/app/content/create_video',
  contentModule: (moduleCode = ':moduleCode') => `/app/content/${moduleCode}`,
  account: '/app/account',
  models: '/app/models',
  noPermission: '/app/no-permission',
};
