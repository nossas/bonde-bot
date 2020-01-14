import dotenv from 'dotenv'
import apm from 'elastic-apm-node/start'
import Http from 'http'
import Express from 'express'
import ExpressSession from 'express-session'
import morgan from 'morgan'
import BodyParser from 'body-parser'
import cors from 'cors'
import Queue from 'bull'
import path from 'path'

dotenv.config({ path: './../.env' })
// apm.start({ active: process.env.NODE_ENV === 'production' })

import { BotFactory } from './bot'
import * as botMiddlewares from './bot/middlewares'
import * as botSkills from './bot/skills'
import * as routes from './routes'
import * as routesMiddlewares from './routes/middlewares'

require('isomorphic-fetch')
require('colors')

//
// Emvironment Variables Polyfill
//
const envs = {
  redisURL: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
}

//
// Globals
//
// global.widgets = {}

//
// Setup Express server
//
const app = Express()
app.engine('pug', require('pug').__express)
app.set('views', path.join(__dirname, '../src/views'));
app.set('view engine', 'pug')
app.use(morgan('combined'))
app.use(Express.static('public'))
app.use(BodyParser.json())
app.use(BodyParser.urlencoded({ extended: true }))
app.use(cors())
app.use(ExpressSession({
  secret: 's3Cur3',
  name: 'sessionId',
  resave: true,
  saveUninitialized: true
}))

//
// Bots fabrication
//
const speech = require(`./bot/speeches/${process.env.SPEECH_VERSION || 'v0'}`).speech
const fabricated = new BotFactory(speech)
  .fabricate()
  .then((bots: any) => {
    bots.forEach((data: any) => {
      // console.log('botConfigs', data)
      const { id, bot, endpoint, botData } = data
      //
      // Set up express endpoints for each bot
      //
      app.get(endpoint, botMiddlewares.verifyValidationToken(bot))
      app.post(endpoint, botMiddlewares.handleMessage(bot))
      app.post(`${endpoint}/mass-message/send`, botMiddlewares.sendMassMessage(bot))

      //
      // Set up pressure stuff
      //
      botSkills.pressure.fetchWidgets({ botData })

      console.info(`Bot[${id}] exposed in endpoint: ${endpoint}`.blue)
    })
  })

//
// Express server routes
//
app.use('/', routes.massMessage)
app.use('/login', routes.login)
app.use('/mass-message', routes.massMessage)
app.use('/pressure', routes.pressure)
app.use('/share', routes.share)
app.use('/health', routes.health)

const queue = new Queue('bot-mass-message', envs.redisURL)
app.post('/enqueue-mass-messages', routesMiddlewares.enqueueMassMessages(queue))

//
// Version check
//
app.get('/_version', (req, res) => {
  const p = require('child_process')
  res.json({ hash: p.execSync('git rev-parse HEAD').toString().trim() })
})

//
// Up the server
//
fabricated.then(() => {
  const port = process.env.PORT || 5000
  Http.createServer(app).listen(port)
  console.info(`🤖  Bot server running at port ${port}`)
})
export default app
