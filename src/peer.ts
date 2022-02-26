import XPeer from "."
import { Media, Message } from "./@types"

import { log } from "."

/**
 * Peer，focus on all kinds of behavior of a single Peer
 */
export default class Peer {
  private isConnected = false
  public media: Media = {}
  public dataChannel: RTCDataChannel | null = null
  /**
   * 
   * @param id 
   * @param nick 
   * @param peerConnection created by the caller that connects to the peer
   */
  constructor(
    public id: string,
    public nick: string,
    public peerConnection: RTCPeerConnection,
    private parentInstance: XPeer
  ) {
    this.id = id
    this.nick = nick
    this.peerConnection = peerConnection
    this.parentInstance = parentInstance
    // initialize rest of the events
    this.initPeerConnectionEvents()
  }


  /**
   * connects to the peer (initive action)
   * creat a offer and send it to other peers
   */
  connect() {
    if (this.isConnected) return Promise.reject(new Error('peer already connected'))


    const pc = this.peerConnection
    return new Promise((resolve, reject) => {
      const dc = pc.createDataChannel('dc')
      this.initDataChannelEvents(dc)
      dc.addEventListener('open', () => {
        log('datachannel 打开了！')
        resolve(this)
        this.dataChannel = dc
        this.isConnected = true

        // emit connected event
        this.parentInstance.emit('connected', this)

        // init datachannel only after it is open

      })


      // 超时拒绝
      setTimeout(() => {
        reject(new Error('connect timeout'))
      }, 10 * 1000)
    })
  }

  /**
   * 接受offer，回复answer
   * @param message 消息内容，包含发送人，和offer信息
   */
  receiveOffer(message: Message) {
    if (message.type === 'offer') {
      this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload))
        .then(() => this.replyAnswer(message))
    }
  }
  /**
   * 收到了answer，设置远程描述，无需回复。
   * 因为answer是从connect->negotiationneeded创建offer发送之后收到的
   * @param answer 收到的answer
   */
  receiveAnswer(answer: RTCSessionDescriptionInit) {
    this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
  }

  /**
   * 
   * @param candidate 收到的candidate协商信息
   */
  receiveCandidate(candidate: RTCIceCandidateInit) {
    log('收到icecandidate，并添加到本地')
    this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
  }
  /**
     * 收到了offer，设置远程描述，然后回复answer
     * @param message 收到的消息，包含发送人，和消息内容
     */
  replyAnswer(message: Message) {
    const pc = this.peerConnection
    if (message.type === 'offer') {
      pc.createAnswer()
        .then(answer => pc.setLocalDescription(answer))
        .then(() => {
          const messageToBeSent: Message = {
            type: 'answer',
            // @ts-ignore
            receiverId: message.userInfo.id,
            payload: pc.localDescription?.toJSON()
          }
          this.parentInstance.signalSend(messageToBeSent)
        }).catch(err => {
          throw new Error(`replayAnswer error: ${err}`)
        })
    }
  }
  /**
   * 初始化datachannel的事件处理函数
   * @param dc 需要初始化的datachannel
   */
  initDataChannelEvents(dc: RTCDataChannel) {
    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const { payload } = JSON.parse(event.data)
        // 停止屏幕共享通过datachannel来通知
        if (payload === 'streamStop:display') {
          // 清掉他的display
          delete this.media.display
          this.parentInstance.emit('streamStop:display', this)
        } else {
          this.parentInstance.emit('message', { peer: this, payload })
        }
      } else {
        this.parentInstance.emit('binary', { peer: this, payload: event.data })
      }
    }
    dc.onclose = () => {
    }
  }
  /**
   * handle events
   */
  initPeerConnectionEvents() {
    const peer = this
    const pc = peer.peerConnection
    pc.oniceconnectionstatechange = () => console.log('ICESTATE_CHANGE', pc.iceConnectionState)
    pc.addEventListener('icecandidate', (event: RTCPeerConnectionIceEvent) => {
      log('PC:[icecandidate]', event)
      if (event.candidate) {
        // event.candidate may be null
        this.parentInstance.signalSend({
          type: 'icecandidate',
          receiverId: peer.id,
          payload: event.candidate
        })
      }
    })
    pc.addEventListener('track', (event: RTCTrackEvent) => {
      log('PC:[track] 主动者收', event)
      // 得到远程音视频轨道
      const stream = event.streams[0]
      // 将轨道添加到其他所有Peer中
      // @ts-ignore
      const sdp: string = event.target.remoteDescription.sdp.toString()
      const setUserStream = () => {
        // 没有视频流 || 视频流为新的
        if (!peer.media.user || peer.media.user.id !== stream.id) {
          peer.media.user = stream
          // 新加入（被动）
          this.parentInstance.emit('stream:user', peer)
        }
      }
      const setDisplayStream = () => {
        if (!peer.media.display || peer.media.display.id !== stream.id) {
          peer.media.display = stream
          // 新加入（被动）
          this.parentInstance.emit('stream:display', peer)
        }
      }
      const streamType = detectTrackType(sdp, event.track)
      if (streamType === 'user') setUserStream()
      else if (streamType === 'display') setDisplayStream()

    })
    pc.addEventListener('negotiationneeded', () => {
      // create offer(只有本地出现变动，本地才会触发negotiationneeded事件从而发送offer)
      // 即：总是发送offer的一方，先有datachannel/media放入peerConnection
      const pc = this.peerConnection
      pc.createOffer()
        .then(offer => {
          // @ts-ignore
          offer.sdp = addCustomLabelToSdp(offer.sdp, this.parentInstance.local.trackTags)
          return pc.setLocalDescription(offer).then(() => offer)
        })
        .then((offer) => {
          this.parentInstance.emit('negotiationneeded:done', this)
          // send offer to the server
          this.parentInstance.signalSend({
            type: 'offer',
            receiverId: this.id,
            payload: offer
          })
        })
    })


    // receives a remote datachannel(passive)
    pc.addEventListener('datachannel', event => {
      const dc = event.channel
      this.dataChannel = dc
      this.isConnected = true
      // emit join event
      this.parentInstance.emit('join', this)
    })
  }
}


function addCustomLabelToSdp(sdp: string = '', str: string = '') {
  console.log('addCustomLabelToSdp', { sdp, str })
  let lines = sdp.split("\n")

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    line = line.replace(/(a=extmap:[0-9]+) [^ \n]+/gi, `$1 ${str}`)
    lines[i] = line
  }

  return lines.join("\n")
}

function detectTrackType(sdp: string, track: MediaStreamTrack) {
  if (sdp.indexOf(`[user/${track.id}]`) !== -1) {
    return 'user'
  } else if (sdp.indexOf(`[display/${track.id}]`) !== -1) {
    return 'display'
  } else {
    // 都匹配不到那就是单独推track，只匹配字符
    if (sdp.indexOf('[user/') !== -1) return 'user'
    else if (sdp.indexOf('[display/') !== -1) return 'display'
  }
  return 'unknown'
}