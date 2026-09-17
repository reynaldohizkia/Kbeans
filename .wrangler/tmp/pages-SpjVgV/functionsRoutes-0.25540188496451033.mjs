import { onRequest as __api___route___ts_onRequest } from "C:\\Users\\Lenovo\\OneDrive\\Documents\\Kbeans\\functions\\api\\[[route]].ts"

export const routes = [
    {
      routePath: "/api/:route*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___route___ts_onRequest],
    },
  ]