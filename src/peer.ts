import { Media } from "./@types"
// TODO: 将Peer封装成一个类，再将各类事件处理函数放在类中
// TODO: 如何处理Peer和xPeer实例之间的联系（当收到candidate，如何发送到远端）：1. 返回数据，外部自行处理
/**
 * Peer，focus on all kinds of behavior of a single Peer
 */
export default class Peer {
  private isConnected = false
  constructor(
    public id: string,
    public nick: string,
    public peerConnection: RTCPeerConnection,
    public media: Media,
    public dataChannel: RTCDataChannel | null) {
    this.id = id
    this.nick = nick
    this.peerConnection = peerConnection
    this.media = media
    this.dataChannel = dataChannel
    // initialize rest of the events

  }
  /**
   * connects to the peer
   */
  connect() {
    const pc = this.peerConnection
    return new Promise((resolve, reject) => {
      const dc = pc.createDataChannel('dc')
      dc.onopen = () => {
        this.dataChannel = dc
        // after connect
        this.isConnected = true

        // init datachannel 
        // initDataChannel(dc)
      }
    })

  }
}