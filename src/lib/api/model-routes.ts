/** Model route admin API — `/v1/*-model-route(s)`. Ported from ModelRouteBackend.js. */
import { get, getList, post } from './client'
import { type ModelRoute, type ListParams, listQuery } from './types'

export const ModelRouteApi = {
  list: (params: ListParams = {}) => getList<ModelRoute[]>('get-model-routes', listQuery(params)),

  get: (owner: string, modelName: string) =>
    get<ModelRoute>('get-model-route', { owner, modelName }),

  add: (route: ModelRoute) => post('add-model-route', route),

  update: (owner: string, modelName: string, route: ModelRoute) =>
    post('update-model-route', route, { owner, modelName }),

  remove: (route: ModelRoute) => post('delete-model-route', route),
}
