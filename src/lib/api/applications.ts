/** Application admin API — `/v1/*-application(s)`. Ported from ApplicationBackend.js. */
import { get, getList, post, idOf } from './client'
import { type Application, type ListParams, listQuery } from './types'

export const ApplicationApi = {
  list: (params: ListParams = {}) => getList<Application[]>('get-applications', listQuery(params)),

  get: (owner: string, name: string) => get<Application>('get-application', { id: idOf(owner, name) }),

  update: (owner: string, name: string, app: Application) =>
    post('update-application', app, { id: idOf(owner, name) }),

  add: (app: Application) => post('add-application', app),

  remove: (app: Application) => post('delete-application', app),

  deploy: (app: Application) => post('deploy-application', app, { id: idOf(app.owner, app.name) }),

  undeploy: (owner: string, name: string) => post('undeploy-application', undefined, { id: idOf(owner, name) }),
}
