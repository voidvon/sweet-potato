import type { CreatorSearchResult } from '../CreatorResultsTable'

export type DouyinAccount = {
  id: string
  name: string
  profileId: string
  status: 'logged_in'
  createdAt: string
}

export type DouyinLoginResult = {
  loggedIn?: boolean
  nickname?: string
  url?: string
}

export type DouyinSearchRecord = CreatorSearchResult

export type DouyinSearchTaskResult = {
  keyword: string
  url: string
  results?: DouyinSearchRecord[]
  totalResults?: number
  previousCount?: number
  hasMore?: boolean
  loadMore?: boolean
}

export type OpenDouyinProfileOptions = {
  href?: string
  creatorName?: string
}
