import EventEmitter = require("eventemitter3")
import XPeer from "."
import { Media, Message } from "./@types"

const log = (...args: any[]) => console.log('<Peer>', ...args)

export enum TrackType {
  User,
  Display,
  Unknown
}
export interface PeerEventMap {
  'stream:user': MediaStream
  'stream:display': MediaStream
  'streamStop:user': void
  'streamStop:display': void
  datachannel: RTCDataChannel
}
/**
 * focus on behaviors of a single Peer
 */
export default class Peer {
  /** only private mutation */
  private _isConnected = false
  /** limited access from instance by developer 
   * to prevent unpredictable issues.
   * @readonly - any mutation would be ignored
   */
  get isConnected() {
    return this._isConnected
  }
  set isConnected(_) {
    console.warn(
      `set isConnected is not allowed, please use connect() to connect to the peer`
    )
  }
  public media: Media = {}
  public dataChannel: RTCDataChannel | null = null
  private eventBus: EventEmitter
  /**
   * 
   * @param id - client's identity
   * @param nick nickname to be shown in the chat room
   * @param peerConnection connection refers to the peer, created by the caller that connects to the peer
   */
  constructor(
    public id: string,
    public nick: string,
    public peerConnection: RTCPeerConnection,
    private parentInstance: XPeer,
    // max retry count
    private retryCount: number = 2,
    // already tried times
    private connectAttemptCount: number = 0
  ) {
    // needless
    // this.id = id
    // this.nick = nick
    // this.peerConnection = peerConnection
    // this.parentInstance = parentInstance
    // initialize rest of the events
    this.initPeerConnectionEvents()

    // instance owned events
    this.eventBus = new EventEmitter()
  }


  /**
   * connects to the peer (initiate action)
   * creat a offer and send it to other peers
   */
  connect() {
    if (this.isConnected) return Promise.reject(new Error('peer already connected'))


    const pc = this.peerConnection
    return new Promise((resolve, reject) => {
      const dc = pc.createDataChannel('dc')

      dc.addEventListener('open', () => {
        log('datachannel open')
        resolve(this)
        this.dataChannel = dc
        this._isConnected = true

        // emit connected event
        this.parentInstance.emit('connect', this)

        // init datachannel only after it is open
        this.initDataChannelEvents(dc)
      })
      // ????????????
      setTimeout(() => {
        if (this.connectAttemptCount <= this.retryCount) {
          this.connectAttemptCount++
          this.connect()
        }
        // ????????????????????????
        else {
          reject(new Error('connect timeout'))
          this.connectAttemptCount = 0
        }
      }, 3 * 1000)
    })
  }

  /**
   * ??????offer?????????{@link replyAnswer}??????answer
   * @param {Message} message ????????????????????????????????????offer??????
   */
  public receiveOffer(message: Message) {
    if (message.type === 'offer') {
      this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload))
        .then(() => this.replyAnswer(message))
    }
  }

  /**
   * ?????????answer???????????????????????????????????????
   * ??????answer??????connect->negotiationneeded??????offer?????????????????????
   * @param answer ?????????answer
   */
  receiveAnswer(answer: RTCSessionDescriptionInit) {
    this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
  }

  /**
   * 
   * @param candidate ?????????candidate????????????
   */
  receiveIceCandidate(candidate: RTCIceCandidateInit) {
    log('??????icecandidate?????????????????????')
    this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
  }

  /**
     * ?????????offer????????????????????????????????????answer
     * @param message ???????????????????????????????????????????????????
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
   * ?????????datachannel?????????????????????
   * @param dc ??????????????????datachannel
   */
  private initDataChannelEvents(dc: RTCDataChannel) {
    dc.onmessage = (event) => {
      const payload = event.data
      if (typeof payload === 'string') {
        // ??????datachannel??????????????????????????????????????????
        if (payload === 'streamStop:display') {
          // ????????????display
          delete this.media.display
          this.parentInstance.emit('streamStop:display', this)
          this.emit('streamStop:display', void 0)
        }
        if (payload === 'streamStop:user') {
          delete this.media.user
          this.emit('streamStop:user', void 0)
          this.parentInstance.emit('streamStop:user', this)
        }
        else {
          this.parentInstance.emit('message', { peer: this, payload })
        }
      } else {
        this.parentInstance.emit('binary', { peer: this, payload })
      }
    }
    dc.onclose = () => {
    }
  }

  /**
   * handle events
   */
  private initPeerConnectionEvents() {
    const peer = this
    const { peerConnection: pc } = peer

    pc.addEventListener('iceconnectionstatechange', peer.onIceConnectionStateChange.bind(peer))
    pc.addEventListener('icecandidate', peer.onIceCandidate.bind(peer))
    pc.addEventListener('track', peer.onTrack.bind(peer))
    pc.addEventListener('negotiationneeded', peer.onNegotiationneeded.bind(peer))
    pc.addEventListener('datachannel', peer.onDataChannel.bind(peer))
  }

  /**
   * handle onIceConnectionStateChange
   */
  private onIceConnectionStateChange() {
    const peer = this
    log('ICE_STATE_CHANGE', peer.peerConnection.iceConnectionState)
  }

  /**
   * handle onIceCandidate
   */
  private onIceCandidate(event: RTCPeerConnectionIceEvent) {
    const peer = this
    log('PC:[icecandidate]', event)
    if (event.candidate) {
      // event.candidate may be null
      peer.parentInstance.signalSend({
        type: 'icecandidate',
        receiverId: peer.id,
        payload: event.candidate
      })
    }
  }

  /**
   * handle onTrack
   */
  private onTrack(event: RTCTrackEvent) {
    log('PC:[track] ????????????', event)
    const peer = this
    // ???????????????????????????
    const stream = event.streams[0]
    // ??????????????????????????????Peer???
    // @ts-ignore
    const sdp: string = event.target.remoteDescription.sdp.toString()
    const setUserStream = () => {
      // ??????????????? || ??????????????????
      if (!peer.media.user || peer.media.user.id !== stream.id) {
        peer.media.user = stream
        // ?????????????????????
        peer.parentInstance.emit('stream:user', peer)

        // ????????????????????????
        peer.emit('stream:user', stream)
      }
    }
    const setDisplayStream = () => {
      if (!peer.media.display || peer.media.display.id !== stream.id) {
        peer.media.display = stream
        // ?????????????????????
        peer.parentInstance.emit('stream:display', peer)
        // ???????????????????????????
        peer.emit('stream:display', stream)
      }
    }
    const streamType = detectTrackType(sdp, event.track)
    if (streamType === TrackType.User) setUserStream()
    else if (streamType === TrackType.Display) setDisplayStream()
  }

  /**
   * handle onNegotiationneeded
   */
  private onNegotiationneeded() {
    const peer = this
    const { parentInstance, peerConnection: pc } = peer
    // create offer(?????????????????????????????????????????????negotiationneeded??????????????????offer)
    // ??????????????????offer??????????????????datachannel/media??????peerConnection

    pc.createOffer()
      .then(offer => {
        // @ts-ignore
        offer.sdp = addCustomLabelToSdp(offer.sdp, parentInstance.local.trackTags)
        return pc.setLocalDescription(offer).then(() => offer)
      })
      .then((offer) => {
        peer.parentInstance.emit('negotiationneeded:done', peer)
        // send offer to the server
        peer.parentInstance.signalSend({
          type: 'offer',
          receiverId: peer.id,
          payload: offer
        })
      })
  }
  /**
   * handle onDataChannel
   * receives a remote datachannel(passive)
   */
  private onDataChannel(event: RTCDataChannelEvent) {
    const peer = this
    const dc = event.channel
    peer.dataChannel = dc
    peer._isConnected = true
    // emit join event
    peer.parentInstance.emit('join', peer)
    // init datachannel events when got one from remote.
    this.initDataChannelEvents(dc)
    // emit datachannel
    // peer.emit('datachannel', dc)
  }

  /**
   * send the message to the peer
   * @param message message to be sent
   */
  public send(message: string) {
    const peer = this
    const { dataChannel } = peer
    if (dataChannel) {
      dataChannel.send(message)
    }
  }

  /**
   * send ArrayBuffer as binary data
   * @param data - a ArrayBuffer
   */
  public sendBinary(data: ArrayBuffer) {
    const peer = this
    const { dataChannel } = peer
    if (dataChannel) {
      dataChannel.send(data)
    }
  }

  /**
   * peer event
   * @param {string} event - the event name
   * @param {function} handler - the event handler
   * @returns {boolean} once - if the event is only triggered once
   */
  public on<E extends keyof PeerEventMap, Arg extends PeerEventMap[E]>(event: E, handler: (stream: Arg) => void, once: boolean = false) {
    this.eventBus[once ? 'once' : 'on'](event, handler)
    /** 
     * ??????join?????????datachannel?????????????????????????????????stream??????
     * ??????????????????peer.on('userStream')???????????????????????????????????????
     * ???emit?????????????????????????????????????????????????????????????????????????????????????????????????????????
    */
    if (event === 'stream:user' && this.media.user) {
      this.emit('stream:user', this.media.user)
    } else if (event === 'stream:display' && this.media.display) {
      this.emit('stream:display', this.media.display)
    }
  }

  /**
   * emit peer event
   */
  private emit<E extends keyof PeerEventMap, Arg extends PeerEventMap[E]>(event: E, arg: Arg) {
    this.eventBus.emit(event, arg)
  }
}


function addCustomLabelToSdp(sdp: string = '', str: string = '') {
  return sdp.split('\n')
    .map(line => line.replace(/(a=extmap:[0-9]+) [^ \n]+/gi, `$1 ${str}`))
    .join('\n')
}

function detectTrackType(sdp: string, track: MediaStreamTrack) {
  if (sdp.indexOf(`[user/${track.id}]`) !== -1) {
    return TrackType.User
  } else if (sdp.indexOf(`[display/${track.id}]`) !== -1) {
    return TrackType.Display
  } else {
    // ?????????????????????????????????track??????????????????
    if (sdp.indexOf('[user/') !== -1) return TrackType.User
    else if (sdp.indexOf('[display/') !== -1) return TrackType.Display
  }
  return TrackType.Unknown
}

