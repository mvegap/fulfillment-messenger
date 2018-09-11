const apiai = require("apiai");
const express = require("express");
const request = require('request');
const bodyParser = require("body-parser");
const uuid = require("uuid");
const axios = require('axios');

const config = module.exports = {
  FB_PAGE_TOKEN: "EAADcmFyXZB38BAKzzsPnKnPGPXIWqUSaIiSNf3ywd82m36x6zyZBx26TZBdsXxtNu3WI4yiCC0EmY3akNXwWltAIdbZC49uhijxs9TdbQ9hT5whr6yrzntCbC6dXdEWwb2Ry7MBYjoK8PHBmo0t5eyhaMAwR6B6JXgq5j8mlli9il7PdIOlE",
  FB_VERIFY_TOKEN: "tokenWebhookdialogmarket",
  API_AI_CLIENT_ACCESS_TOKEN: "af1f8d0a68cc45b9b9f28d058cf92a02",
  FB_APP_SECRET: "4f853aa43c3accd0cdf767f211ef2442",
};

const app = express();

// seteamos el puerto del webhook
app.set("port", process.env.PORT || 5000);

app.use(express.static("public"));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}));

// Process application/json
app.use(bodyParser.json());

// Ruta index del webhook
app.get("/", function (req, res) {
  res.send("Hello world!. I'm webhook.");
});

// for Facebook verification
// Para las validaciones con Facebook
app.get("/webhook/", function (req, res) {
  
  console.log("request");
  
  if(req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.FB_VERIFY_TOKEN){
    res.status(200).send(req.query["hub.challenge"]);
    console.log('ok response');
  }else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);
  }

});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */

app.post("/webhook/", function (req, res){

  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == "page") {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function (pageEntry) {

      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {
        if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });
    // Assume all went well.
    // You must send back a 200, within 20 seconds
    res.sendStatus(200);
  }
});


const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
  language: "es",
  requestSource: "fb"
});


const sessionIds = new Map();


function receivedMessage(event) {

  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  if (!sessionIds.has(senderID)) {
    sessionIds.set(senderID, uuid.v1());
  }

  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;

  if (messageText) {
    //send message to api.ai
    sendToApiAi(senderID, messageText);
  } else if (messageAttachments) {
    handleMessageAttachments(senderID, messageAttachments);
  }

}



function sendToApiAi(sender, text) {
  sendTypingOn(sender);
  let apiaiRequest = apiAiService.textRequest(text, {
    sessionId: sessionIds.get(sender)
  });

  apiaiRequest.on("response", response => {
    if (isDefined(response.result)) {
      handleApiAiResponse(sender, response);
    }
  });

  apiaiRequest.on("error", error => console.error(error));
  apiaiRequest.end();
}

function handleMessageAttachments(sender,received_postback){
  
  let response;

  // get the payload for postback
  let payload = received_postback.payload;

  if(payload === 'yes'){
    response = { 'text': 'Gracias' }
  }else if(payload === 'no'){
    response = {'text':'Opps, no  entiendo lo enviado.'}
  }else if(payload = 'myLatLng'){
    response = { 'text' : 'Gracias por enviarnos tu ubicación' }
  }

  callSendAPI(sender,response);
}

// Habilita la accion tipeando antes de enviar el mensaje
const sendTypingOn = (recipientId) => {
  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_on"
  };
  callSendAPI(messageData);
}


/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
const callSendAPI = async (messageData) => {
  
  const url = "https://graph.facebook.com/v3.0/me/messages?access_token=" + config.FB_PAGE_TOKEN;
  await axios.post(url, messageData).then(function (response) {
    
    if (response.status == 200) {
      var recipientId = response.data.recipient_id;
      var messageId = response.data.message_id;
      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",messageId,recipientId);
      }else {
        console.log("Successfully called Send API for recipient %s",recipientId);
      }
    }
  
  }).catch(function (error) {
    console.log(error.response.headers);
  });

}




const isDefined = (obj) => {
  
  if (typeof obj == "undefined") {
    return false;
  }
  if (!obj) {
    return false;
  }
  return obj != null;

}




function handleApiAiResponse(sender, response) {
  
  let responseText = response.result.fulfillment.speech;
  let responseData = response.result.fulfillment.data;
  let messages = response.result.fulfillment.messages;
  let action = response.result.action;
  let contexts = response.result.contexts;
  let parameters = response.result.parameters;
  
  sendTypingOff(sender);
  
  if (responseText == "" && !isDefined(action)) {

    console.log("Unknown query" + response.result.resolvedQuery);
    sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");

  }else if(isDefined(action)) {
    
    handleApiAiAction(sender, action, responseText, contexts, parameters);
  
  }else if (isDefined(responseData) && isDefined(responseData.facebook)) {
    
    try {
      console.log("Response as formatted message" + responseData.facebook);
      sendTextMessage(sender, responseData.facebook);
    }catch (err) {
      sendTextMessage(sender, err.message);
    }

  }else if (isDefined(responseText)) {
    sendTextMessage(sender, responseText);
  }

}



// Deshabilita la accion tipeando despues de enviar el mensaje
const sendTypingOff = (recipientId) => {
  var messageData = {
    recipient: {
      id: recipientId
    },
    sender_action: "typing_off"
  };
  
  callSendAPI(messageData);
}



const sendTextMessage = async (recipientId, text) => {

  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: text
    }
  };
  
  await callSendAPI(messageData);
}




const sendTemplateMessage = async(recipientId, text) => {
  
  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment:{
        type: "image",
        payload:{
          url: "https://img.peru21.pe/files/article_content_ec_fotos/uploads/2017/08/11/598dca1e1721e.jpeg",
          is_reusable: true
        }
      }
    }
  };
  
  await callSendAPI(messageData);

}



const sendTemplateButton = async(recipientId, text) => {
  
  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment:{
        type: "template",
        payload: {
          template_type: "button",
          text: "Para continuar tenemos que validar tus datos, puedes hacerlo en el siguiente enlace.",
          buttons:[
            {
              type: "web_url",
              url: "https://www.google.com.pe",
              title: "Validar mis datos",
              webview_height_ratio: "full"
            }
          ]
        }
      }
    }
  };
  
  await callSendAPI(messageData);
}






const sendTemplateMedia = async(recipientId, text) => {
  
  var messageData = {
    recipient:{
      id: recipientId
    },
    message:{
      attachment:{
        type: "template",
        payload:{
          template_type : "media",
          elements:[
            {
              media_type: "video",
              url: "https://www.facebook.com/TheMarsSocietyPeru/videos/2186790221597662/"
            }
          ]
        }
      }
    },
  };
  
  await callSendAPI(messageData);

}



const sendTemplateQuickReply = async(recipientId, text) => {
  
  var messageData = {
    recipient:{
      id: recipientId
    },
    message:{
      text: "Para continuar, necesitamos que nos envíes tu ubicación.",
      quick_replies:[
        {
          content_type: "location",
          title: "Envíanos tu ubicación",
          payload: "no"
        }
      ]
    }
  };
  
  await callSendAPI(messageData);

}




const sendTemplatePhoneNumber = async(recipientId, text) => {

  var messageData = {
    recipient:{
      id: recipientId
    },
    message:{
      attachment:{
        type: "template",
        payload: {
          template_type : "button",
          text: "Este es nuestro número de contacto para mayor información: ",
          buttons: [
            {
              type: "phone_number",
              title: "Llamar",
              payload: "+51996634147"
            }
          ]
        }
      }
    }
  };

  await callSendAPI(messageData);

}







const sendTemplateCard = async(recipientId, text) => {

  var messageData = {

    recipient:{
      id: recipientId
    },
    message:{
      attachment:{
        type: "template",
        payload: {
          template_type : "generic",
          elements: [
            {
              title: "Bienvenido",
              image_url: "https://blog.bannersnack.com/wp-content/uploads/2018/01/Blog-Header-1-770x395.png",
              subtitle: "Aquí irá el subtitulo de la tarjeta mediante el payload.",
              default_action:{
                type: "web_url",
                url: "https://petersfancybrownhats.com",
                messenger_extensions: false,
                webview_height_ratio: "tall",
                fallback_url: "https://petersfancybrownhats.com"
              },
              buttons:[
                {
                  type : "web_url",
                  url : "https://petersfancybrownhats.com",
                  title : "Visitar web"
                },
                {
                  type: "postback",
                  title: "Continuar chateando..",
                  payload: "DEVELOPER_DEFINED_PAYLOAD"
                }
              ]
            }
          ]
        }
      }
    }

  };

  await callSendAPI(messageData);
  
}




function handleApiAiAction(sender,action,responseText,contexts,parameters){

  switch(action){

    case 'getNameByDNI':
      var responseText = "DNI Validator";
      sendTemplateMessage(sender, responseText);
    break;

    case 'send-text':
      var responseText = 'Hola, esto es una prueba del texto enviado hacia el webhook.';
      sendTextMessage(sender,responseText);
    break;

    case 'loadURL': 
      var responseText = 'Respuesta del boton hacia una URL';
      sendTemplateButton(sender, responseText);
    break;

    case 'getVideo':  
      var responseText = 'Media template for VIDEO files';
      sendTemplateMedia(sender, responseText);
    break;

    case 'quickReplyLocation':  
      var responseText = "API Location for Facebook Messenger";
      sendTemplateQuickReply(sender, responseText);
    break;

    case 'call_number':
      var responseText = "Llamando...";
      sendTemplatePhoneNumber(sender, responseText);
    break;

    case 'getCard':
      var responseText = "Respuesta mediante tarjeta...";
      sendTemplateCard(sender,responseText);
    break;

    default:
      sendTextMessage(sender,responseText);

  }
  
}

app.listen(app.get("port"), function () {
  console.log("Magic started on port", app.get("port"));
});