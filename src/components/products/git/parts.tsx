'use client'

/**
 * Shared UI parts for the Git dashboard — the small, reused pieces of the gitea-parity
 * repo view: a copy-to-clipboard button, the HTTPS/SSH clone panel, a branch/tag ref
 * selector, the path breadcrumb, the file/folder icon, the Code/Commits/Issues/PRs/
 * Actions tab strip, and the honest "not built yet" tab. Bigger views (list, tree/blob,
 * commits) live in their own files and compose these.
 *
 * @hanzo/gui v5 shorthands only (bg/p/px/py/gap/rounded/items/justify/…).
 */
import { useMemo, useState } from 'react'
import { Button, Input, Popover, Text, XStack, YStack } from '@hanzo/gui'
import {
  Check,
  ChevronDown,
  Copy,
  File as FileIcon2,
  Folder,
  GitBranch,
  Play,
  Search,
  Tag,
} from '@hanzogui/lucide-icons-2'

import type { Ref, RefList } from '~/lib/api/git'
import { paper } from '~/components/ui/paper'

/** Copy a value to the clipboard, showing a transient check. ONE control, DRY. */
export function CopyButton({
  value,
  label = 'Copy',
  ariaLabel,
  size = '$2',
}: {
  value: string
  label?: string
  ariaLabel?: string
  size?: '$1' | '$2' | '$3'
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked (insecure context) — the value is already visible */
    }
  }
  return (
    <Button
      size={size}
      chromeless
      aria-label={ariaLabel ?? label}
      disabled={!value}
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      onPress={() => void copy()}
    >
      <Text fontSize="$2" color="$color11">
        {copied ? 'Copied' : label}
      </Text>
    </Button>
  )
}

/**
 * The clone panel — a segmented HTTPS/SSH toggle over one copyable URL box, the gitea
 * "Clone" affordance. Shows whichever protocol is selected; copy yields the raw URL.
 */
export function ClonePanel({ cloneUrl, sshUrl }: { cloneUrl: string; sshUrl: string }) {
  const [proto, setProto] = useState<'https' | 'ssh'>('https')
  const value = proto === 'https' ? cloneUrl : sshUrl
  const Seg = ({ id, label }: { id: 'https' | 'ssh'; label: string }) => (
    <Button
      size="$2"
      chromeless={proto !== id}
      bg={proto === id ? '$color5' : 'transparent'}
      onPress={() => setProto(id)}
      aria-label={`Show ${label} clone URL`}
    >
      <Text fontSize="$2" fontWeight={proto === id ? '700' : '400'} color="$color12">
        {label}
      </Text>
    </Button>
  )
  return (
    <YStack gap="$1.5" minW={260} flex={1}>
      <XStack items="center" gap="$1">
        <Seg id="https" label="HTTPS" />
        <Seg id="ssh" label="SSH" />
      </XStack>
      <XStack
        items="center"
        gap="$2"
        px="$2.5"
        py="$2"
        borderWidth={1}
        borderColor="$borderColor"
        rounded="$3"
        bg="$color1"
        minW={0}
      >
        <Text className="mono" fontSize="$2" color="$color12" flex={1} numberOfLines={1} selectable>
          {value || '—'}
        </Text>
        {value ? <CopyButton value={value} ariaLabel={`Copy ${proto} clone URL`} /> : null}
      </XStack>
    </YStack>
  )
}

/** Folder / file icon for a tree row. */
export function EntryIcon({ type }: { type: 'tree' | 'blob' }) {
  return type === 'tree' ? <Folder size={15} color="$color11" /> : <FileIcon2 size={15} color="$color9" />
}

/**
 * Branch/tag selector — a Popover with a filter box and two grouped sections
 * (branches, then tags), a check on the active ref. Prop-driven + self-contained.
 * `null` refs → a disabled trigger showing just the active ref name (degraded but honest).
 */
export function RefSelector({
  refs,
  active,
  onSelect,
  loading,
}: {
  refs: RefList | null
  active: string
  onSelect: (ref: string) => void
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const isTag = useMemo(() => refs?.tags.some((t) => t.name === active) ?? false, [refs, active])

  const filt = (list: Ref[]) => {
    const s = q.trim().toLowerCase()
    return s ? list.filter((r) => r.name.toLowerCase().includes(s)) : list
  }
  const branches = filt(refs?.branches ?? [])
  const tags = filt(refs?.tags ?? [])

  const pick = (name: string) => {
    onSelect(name)
    setOpen(false)
    setQ('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-start">
      <Popover.Trigger asChild>
        <Button
          size="$2"
          minW={150}
          justify="space-between"
          borderWidth={1}
          borderColor="$borderColor"
          disabled={loading}
          icon={isTag ? <Tag size={14} /> : <GitBranch size={14} />}
          iconAfter={<ChevronDown size={14} opacity={0.6} />}
        >
          <Text className="mono" fontSize="$2" color="$color12" numberOfLines={1} flex={1}>
            {active || '—'}
          </Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content {...paper} p="$1.5" minW={240}>
        <YStack gap="$1.5" minW={240} maxH={380}>
          <XStack
            items="center"
            gap="$2"
            px="$2"
            py="$1.5"
            borderWidth={1}
            borderColor="$borderColor"
            rounded="$3"
            bg="$color1"
          >
            <Search size={13} color="$color10" />
            <Input
              unstyled
              flex={1}
              fontSize="$2"
              color="$color12"
              placeholder="Filter branches/tags…"
              value={q}
              onChangeText={setQ}
            />
          </XStack>
          <YStack gap="$0.5" maxH={320} overflow="scroll">
            <RefGroup label="Branches" icon={<GitBranch size={12} color="$color10" />} rows={branches} active={active} onPick={pick} />
            <RefGroup label="Tags" icon={<Tag size={12} color="$color10" />} rows={tags} active={active} onPick={pick} />
            {branches.length === 0 && tags.length === 0 ? (
              <Text fontSize="$2" color="$color10" px="$2.5" py="$2">
                No matching refs.
              </Text>
            ) : null}
          </YStack>
        </YStack>
      </Popover.Content>
    </Popover>
  )
}

function RefGroup({
  label,
  icon,
  rows,
  active,
  onPick,
}: {
  label: string
  icon: React.ReactNode
  rows: Ref[]
  active: string
  onPick: (name: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <YStack gap="$0.5">
      <XStack items="center" gap="$1.5" px="$2.5" pt="$1.5" pb="$0.5">
        {icon}
        <Text fontSize="$1" fontWeight="700" color="$color10">
          {label}
        </Text>
      </XStack>
      {rows.map((r) => (
        <XStack
          key={r.name}
          items="center"
          gap="$2"
          px="$2.5"
          py="$1.5"
          rounded="$3"
          cursor="pointer"
          hoverStyle={{ bg: '$color4' }}
          bg={active === r.name ? '$color4' : 'transparent'}
          onPress={() => onPick(r.name)}
        >
          <XStack width={14} items="center" justify="center">
            {active === r.name ? <Check size={13} /> : null}
          </XStack>
          <Text className="mono" fontSize="$2" color="$color12" flex={1} numberOfLines={1}>
            {r.name}
          </Text>
        </XStack>
      ))}
    </YStack>
  )
}

/**
 * Path breadcrumb — the repo name (→ root) then each cumulative directory crumb, the
 * gitea file-nav header. The leaf is plain text; every ancestor is clickable.
 */
export function PathBreadcrumb({
  repoName,
  crumbs,
  onNavigate,
}: {
  repoName: string
  crumbs: { name: string; path: string }[]
  onNavigate: (path: string) => void
}) {
  return (
    <XStack items="center" gap="$1" flexWrap="wrap">
      <Text
        className="mono"
        fontSize="$3"
        fontWeight="700"
        color="$color11"
        cursor="pointer"
        hoverStyle={{ color: '$color12' }}
        onPress={() => onNavigate('')}
      >
        {repoName}
      </Text>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          <XStack key={c.path} items="center" gap="$1">
            <Text fontSize="$3" color="$color9">
              /
            </Text>
            {last ? (
              <Text className="mono" fontSize="$3" color="$color12">
                {c.name}
              </Text>
            ) : (
              <Text
                className="mono"
                fontSize="$3"
                color="$color11"
                cursor="pointer"
                hoverStyle={{ color: '$color12' }}
                onPress={() => onNavigate(c.path)}
              >
                {c.name}
              </Text>
            )}
          </XStack>
        )
      })}
    </XStack>
  )
}

// ── Repo tabs ────────────────────────────────────────────────────────────────

export type RepoTab = 'code' | 'commits' | 'issues' | 'pulls' | 'actions'

export const REPO_TABS: { id: RepoTab; label: string }[] = [
  { id: 'code', label: 'Code' },
  { id: 'commits', label: 'Commits' },
  { id: 'issues', label: 'Issues' },
  { id: 'pulls', label: 'Pull requests' },
  { id: 'actions', label: 'Actions' },
]

/** The repo tab strip — one active underline, the gitea repo navbar. */
export function RepoTabs({ active, onSelect }: { active: RepoTab; onSelect: (t: RepoTab) => void }) {
  return (
    <XStack gap="$1" borderBottomWidth={1} borderColor="$borderColor" flexWrap="wrap">
      {REPO_TABS.map((t) => {
        const on = t.id === active
        return (
          <XStack
            key={t.id}
            px="$3"
            py="$2"
            cursor="pointer"
            borderBottomWidth={2}
            borderColor={on ? '$color12' : 'transparent'}
            onPress={() => onSelect(t.id)}
            hoverStyle={{ bg: '$color2' }}
          >
            <Text fontSize="$3" fontWeight={on ? '700' : '400'} color={on ? '$color12' : '$color11'}>
              {t.label}
            </Text>
          </XStack>
        )
      })}
    </XStack>
  )
}

/** The honest "not built yet" tab body for Issues / PRs / Actions (backend not live). */
export function ComingSoonTab({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <YStack
      borderWidth={1}
      borderColor="$borderColor"
      borderStyle="dashed"
      rounded="$4"
      p="$6"
      gap="$2"
      items="center"
      maxW={560}
      self="center"
      width="100%"
    >
      <YStack width={44} height={44} items="center" justify="center" rounded="$4" bg="$color3">
        {icon}
      </YStack>
      <Text fontSize="$5" fontWeight="600" text="center">
        {title}
      </Text>
      <Text fontSize="$3" color="$color11" text="center" maxW={420}>
        {description}
      </Text>
    </YStack>
  )
}

/** The Actions tab body — same honest empty, with the run icon. */
