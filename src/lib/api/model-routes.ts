/** Model route admin API — the `/v1/ai/routes` resource. */
import { get, getList, patch, post, del, memberOf } from './client'
import { type ModelRoute, type ListParams, listQuery } from './types'

const ROUTES = 'ai/routes'

export const ModelRouteApi = {
  list: (params: ListParams = {}) => getList<ModelRoute[]>(ROUTES, listQuery(params)),

  get: (owner: string, modelName: string) => get<ModelRoute>(memberOf(ROUTES, owner, modelName)),

  add: (route: ModelRoute) => post(ROUTES, route),

  update: (owner: string, modelName: string, route: ModelRoute) =>
    patch(memberOf(ROUTES, owner, modelName), route),

  remove: (route: ModelRoute) => del(memberOf(ROUTES, route.owner, route.name)),
}
