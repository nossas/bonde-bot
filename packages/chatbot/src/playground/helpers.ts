import 'colors'
/* import * as botAI from '../ai' */
/* import * as botHelpers from '../helpers' */
import * as botAI from '../bot/ai'
import * as botSpeeches from '../bot/speeches'
import actionStrategy from './strategy'
import * as ChatbotInteractions from './interactions'

/**
  * Reply function interface to save the bot's reply text
  * before send it to user.
  *
  * @param [required] botData {Object} Bot's config data object
  * @param [required] payload {Object} Facebook messenger API received request payload object
  * @param [required] reply {Function} Messenger bot's reply function
  * @param [required] profile {Object} User's profile object received by Facebook Messenger API
  */
export const handleReplyWithSave = ({ bot, botData, payload, reply, profile }) => (message, action) => {
  // Function that saves the interaction on database
  // and sends the message to the Messenger.
  const saveAndReply = (msg, callback?: any) => {
    const opts = {
      chatbotId: botData.id,
      recipientId: payload.recipient.id,
      senderId: payload.sender.id,
      interaction: { is_bot: true, message: msg, action }
    }
    ChatbotInteractions
      .insert(opts)
      .then(() => {
        reply(msg, callback)
      })
      .catch(err => {
        console.error('helpers.ts :: handleReplyWithSave :: saveAndReplay ->', err)
      })
  }

  const normalize = msg => {
    switch (msg.constructor) {
      case Function: return msg(profile)
      case String: return { text: msg }
      case Object: return msg
      default: throw new TypeError('The type of message variable is not supported.')
    }
  }

  if (message.constructor === Array) {
    //
    // Recursive function to reply a message with multiple sequential messages.
    //
    // @param [required] index {Integer} Index of message from messages array.
    //
    const replySequentially = index => {
      if (index < message.length) {
        if (index > 0) {
          /* console.log('helpers.ts :: handleReplyWithSave :: 58 :: typing_on') */
          bot.sendSenderAction(payload.sender.id, 'typing_on')
        }
        saveAndReply(normalize(message[index]), err => {
          if (err) console.error('Error sending multiple messages: (%s)', JSON.stringify(err))
          setTimeout(() => replySequentially(index + 1), 2000)
        })
      } else {
        console.log('helpers.ts :: handleReplyWithSave :: 65 :: typing_off')
        bot.sendSenderAction(payload.sender.id, 'typing_off')
      }
    }

    //
    // Start replying with index 0 of message array.
    //
    replySequentially(0)
  } else saveAndReply(normalize(message))
}

export const receive = (bot, speech, botData, extraConfigs) => (payload, reply, action) => {
  console.log('helpers.ts :: receive :: 76 :: mark_seen')
  bot.sendSenderAction(payload.sender.id, 'mark_seen')

  bot.getProfile(payload.sender.id, async (err, profile) => {
    /* console.log('helpers.ts :: receive :: 80 :: typing_on') */
    bot.sendSenderAction(payload.sender.id, 'typing_on')

    if (err) console.error(`${JSON.stringify(err)}`.red)
    //
    // Wraps the original reply function with the behaviour
    // to save the user's interaction.
    //
    const replyWithSave = handleReplyWithSave({ bot, botData, payload, reply, profile })

    //
    // Speech action strategy
    //
    const strategyArgs = { speech, action, payload, profile, botData, reply: replyWithSave }
    const actions = await actionStrategy(strategyArgs)

    actions.anywhere()

    //
    // Speech message based on received quick reply action
    //
    const message = speech.messages[action]

    if (message) {
      replyWithSave(message, action)
    } else {
      const { witServerAccessToken, defaultErrorMessage } = extraConfigs()
      actions
        .ensure()
        .then(dispatched => {
          if (!dispatched && payload.message && payload.message.text && witServerAccessToken) {
            botAI
              .client(witServerAccessToken)
              .message(payload.message.text, {})
              .then(({ entities }) => {
                if (entities.intent && entities.intent.length > 0) {
                  // TODO: understand better about how it works
                  const intent = entities.intent[0]
                  const message = speech.messages[intent.value]
                  return replyWithSave(message, intent.value)
                }
                throw new Error('bugged_out')
              })
              .catch(err => {
                console.error('helpers.ts :: receive :: BotAI ->', err)
                replyWithSave(defaultErrorMessage || botSpeeches.messages.BUGGED_OUT, 'bugged_out')
              })
          } else if (!dispatched) {
            replyWithSave(defaultErrorMessage || botSpeeches.messages.BUGGED_OUT, 'bugged_out')
          } else {
            /* console.log('helpers.ts :: receive :: 129 :: typing_off') */
            bot.sendSenderAction(payload.sender.id, 'typing_off')
          }
        })
        .catch(err => {
          console.error('helpers.ts :: receive :: ensure ->', err)
          replyWithSave(defaultErrorMessage || botSpeeches.messages.BUGGED_OUT, 'bugged_out')
        })
    }
  })
}
