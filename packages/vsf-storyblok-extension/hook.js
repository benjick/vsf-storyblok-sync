import { json, Router } from 'express'
import request from 'request'
import { promisify } from 'util'
import { apiStatus } from '../../../lib/util'
import { fullSync } from './fullSync'

const rp = promisify(request)

const rp = promisify(request)

const log = (string) => {
  console.log('📖 : ' + string) // eslint-disable-line no-console
}

const transformStory = (index) => ({ id, ...story } = {}) => {
  story.content = JSON.stringify(story.content)
  story.full_slug = story.full_slug.replace(/^\/|\/$/g, '')
  return {
    index: index,
    type: 'story', // XXX: Change to _doc once VSF supports Elasticsearch 6
    id: id,
    body: story
  }
}

function hook ({ config, db, index, storyblokClient }) {
  if (!config.storyblok || !config.storyblok.hookSecret) {
    throw new Error('🧱 : config.storyblok.hookSecret not found')
  }

  async function syncStory (req, res) {
    if (process.env.VS_ENV !== 'dev') {
      if (!req.query.secret) {
        return apiStatus(res, {
          error: 'Missing query param: "secret"'
        }, 403)
      }

      if (req.query.secret !== config.storyblok.hookSecret) {
        return apiStatus(res, {
          error: 'Invalid secret'
        }, 403)
      }
    }

    const cv = Date.now() // bust cache
    const { story_id: id, action } = req.body

    try {
      switch (action) {
        case 'published':
          const { data: { story } } = await storyblokClient.get(`cdn/stories/${id}`, {
            cv,
            resolve_links: 'url'
          })
          const publishedStory = transformStory(index)(story)

          await db.index(publishedStory)
          log(`Published ${story.full_slug}`)
          break

        case 'unpublished':
          const unpublishedStory = transformStory(index)({ id })
          await db.delete(unpublishedStory)
          log(`Unpublished ${id}`)
          break

        case 'release_merged':
        case 'branch_deployed':
          await fullSync(db, config, storyblokClient, index)
          break
        default:
          break
      }
      if (config.storyblok.invalidate) {
        log(`Invalidating cache... (${config.storyblok.invalidate})`)
        await rp({
          uri: config.storyblok.invalidate
        })
        log('Invalidated cache ✅')
      }
      return apiStatus(res)
    } catch (error) {
      console.log('Failed fetching story', error)
      return apiStatus(res, {
        error: 'Fetching story failed'
      })
    }
  }

  const api = new Router()

  api.use(json())

  api.get('/hook', (req, res) => {
    res.send('You should POST to this endpoint')
  })
  api.post('/hook', syncStory)

  return api
}

export { hook }
