import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PaasApi } from '~/lib/api/paas'
import { launchDeploy, type LaunchStep } from './deploy'

vi.mock('~/lib/api/paas', () => ({
  PaasApi: {
    createProject: vi.fn(),
    createApp: vi.fn(),
    deploy: vi.fn(),
  },
}))

const mockApi = PaasApi as unknown as {
  createProject: ReturnType<typeof vi.fn>
  createApp: ReturnType<typeof vi.fn>
  deploy: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.createProject.mockResolvedValue({ id: 'p1', slug: 'proj', name: 'proj' })
  mockApi.createApp.mockResolvedValue({ id: 'a1', slug: 'web' })
  mockApi.deploy.mockResolvedValue({ id: 'd1' })
})

describe('launchDeploy', () => {
  it('creates a new project, then the app, then deploys — in order — for a service', async () => {
    const steps: LaunchStep[] = []
    const out = await launchDeploy(
      { newProjectName: 'proj', appName: 'web', target: 'service', ref: 'https://github.com/o/r', branch: 'main' },
      (s) => steps.push(s),
    )
    expect(steps).toEqual(['project', 'app', 'deploy'])
    expect(mockApi.createProject).toHaveBeenCalledWith({ name: 'proj' })
    expect(mockApi.createApp).toHaveBeenCalledWith('proj', {
      name: 'web',
      source: 'git',
      repo: { url: 'https://github.com/o/r', branch: 'main' },
      buildType: 'nixpacks',
    })
    expect(mockApi.deploy).toHaveBeenCalledWith('proj', 'web', {})
    expect(out).toEqual({ project: 'proj', app: 'web' })
  })

  it('uses an existing project (no createProject) for a container image', async () => {
    await launchDeploy({ projectSlug: 'existing', appName: 'api', target: 'container', ref: 'ghcr.io/o/app:2.0' })
    expect(mockApi.createProject).not.toHaveBeenCalled()
    expect(mockApi.createApp).toHaveBeenCalledWith('existing', {
      name: 'api',
      source: 'image',
      image: { repository: 'ghcr.io/o/app', tag: '2.0' },
      buildType: 'image',
    })
    expect(mockApi.deploy).toHaveBeenCalledWith('existing', 'web', { tag: '2.0' })
  })

  it('throws when neither an existing nor a new project is given', async () => {
    await expect(launchDeploy({ appName: 'x', target: 'service', ref: 'https://github.com/o/r' })).rejects.toThrow()
    expect(mockApi.createApp).not.toHaveBeenCalled()
  })
})
