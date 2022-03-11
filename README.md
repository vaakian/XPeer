## [XPeer](#) · [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/vaakian/xpeer/blob/main/LICENSE) [![npm version](https://img.shields.io/npm/v/xpeer.svg?style=flat)](https://www.npmjs.com/package/xpeer) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#)


## install & usage

### npm
```shell
npm i -s xpeer
```
### yarn
```shell
yarn add xpeer
```
## signal server

> NOTE: to use XPeer, the [XSignal](https://github.com/vaakian/XSignal) is essential to work with, provides signal exchanging services between peers.

## TODO
- [ ] 封装文件发送`sendFile(file)`和接收`emit('file', file)`，自动编解码，并提供发送进度。

### 项目引入

[MDN: RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection)
```js
import XPeer, { XPeerInit } from 'xpeer'
const options: XPeerInit = {
    signalServer: string, // 'ws://localhost:8080',
    peerConfig: RTCConfiguration
}
const xPeer = new XPeer(options)
```

### 外部`<script>`引入

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- 引入 -->
    <script src="https://raw.githubusercontent.com/vaakian/XPeer/main/bundle/xpeer.bundle.min.js"></script>
    <title>XPeer</title>
</head>

<body>

</body>
<script>
    // 直接使用
    const xPeer = new XPeer({
        signalServer: string, // 'ws://localhost:8080',
        peerConfig: RTCConfiguration
    })
</script>

</html>
```

### METHODS

通过`xPeer`实例所分享的任何数据，都是广播性质的。
[MDN: MediaStreamConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
```ts

// 加入房间
xPeer.join({roomId, nick}).then(local => {
    xPeer.local === local // true
})
// 退出房间
xPeer.leave()
// 共享摄像头
xPeer.shareUser(constraints: MediaStreamConstraints)
// 共享屏幕
xPeer.shareDisplay(constraints: DisplayMediaStreamConstraints)
// 设置静音
xPeer.setMute(kind: 'audio'| 'video', enabled: boolean)

// 通过dataChannel发送数据
xPeer.send(message: string)
// 通过dataChannel发送二进制数据（类型为ArrayBuffer）
xPeer.sendBinary(binary: ArrayBuffer)
```


### EVENTS

```ts

xPeer.on('join', (peer: Peer) => {
    // 有新的peer加入
})
xPeer.on('connect', (peer: Peer) => {
    // 后加入房间，成功连接房间内的其他peer
})
xPeer.on('leave', (peerInfo: PeerInfo) => {
    // 有peer离开
})
xPeer.on('roomInfo', (users: PeerInfo[]) => {
    // 房间内的peer信息
})
xPeer.on('signal:open', () => {
    // 已连接到signal server
})
xPeer.on('signal:error', () => {
    // 连接signal server失败
})
xPeer.on('signal:close', () => {
    // signal server连接关闭
})
xPeer.on('stream:user', (peer: Peer) => {
    // 有新的用户推送摄像头
})

xPeer.on('stream:display', (peer: Peer) => {
    // 有新的用户推送屏幕
})
xPeer.on('streamStop:display', (peer: Peer)=> {
    // 有用户停止推送屏幕
})


xPeer.on('message', ({ peer, payload }) => {
    // dataChannel收到文本数据
})
xPeer.on('binary', ({ peer, binary }) => {
    // dataChannel收到二进制数据
    // binary is a ArrayBuffer
})

```


## Peer自有事件和方法

### Events

```js
// suppose peer is a Peer instance
const peer = xPeer.local.peers[0]

// 连接状态
peer.isConnected // true or false

peer.on('userStream', (stream: MediaStream) => {
    // 该peer推送摄像头
})
peer.on('displayStream', (stream: MediaStream) => {
    // 该peer推送屏幕
})
```

### Methods

通过`peer`自身发送的方法，可以理解为「私聊」，仅仅是把消息发送给该`peer`，不会被广播。
```js

// send string
peer.send('message')

// send ArrayBuffer as binary
peer.sendBinary(new ArrayBuffer(...))
```




## Draft
- 断连，websocket心跳.

- addTrack -> addEvent -> setRemote 顺序

- 多人连接应该是多个PeerConnection

- [coturn](https://juejin.cn/post/6999962039930060837)

- 先进入房间：negotiate，再分享新的源renegotiate

In short, in order to add video or audio to an existing connection, you need to renegotiate the connection every time you make a media change. Basically you register a listener:
```js
pc.onnegotiationneeded

这个重新negotiate和初次建立的区别差不多，初次建立也会触发onnegotiationneeded事件。
在处理方式唯一不同的地方是：在接收offer时，需要区分是否已有PeerConnection，如果有，则不需要重新建立，只需要更新offer（CreateOffer）。
```

## TODO： 前端

[]断连就退出界面，提示断连。

[]切换摄像头：先退出界面，再重新进入界面，或者重新negotiate

[]声音mute和unmute

[]屏幕共享：取消事件

https://www.w3.org/TR/webrtc/#dfn-update-the-negotiation-needed-flag


## TODO： XPeer

# tell screen and video

https://www.kevinmoreland.com/articles/03-22-20-webrtc-mediastream-tracks


dataChannel一旦建立之后，再重新设置local和remote都没关系。  独立的sdp-信息可以在sdp中存储。
同理，track一旦接收到之后，再重新设置local和remote也没关系。 独立的sdp-信息可以在sdp中存储。





前端部分：ios自动播放问题¿


推流端：创建dc/推流(打上tag，存下来) -> 触发negotiationneeded(从本地读tag，放到sdp中) -> createOffer & setLocal & send -> receiveAnswer & setLocal -> iceCandidate -> pc.onTrack/dc.onmessage
接收端：receiveOffer -> setRemote -> createAnswer & setLocal -> pc.onTrack / dc.onmessage

pc.onTrack: 读tag区分类别，并分别存储。

一次negotiation(offer-answer)可以推多个流：包括多个dataChannel/多个track。
所以打tag，需要在sdp中一次打完。

单独推流无法匹配上ID，但此时只需要匹配display字段存在，而无需匹配id。

需要匹配trackId的情况只有一次发送多个track时。

每当negotiation完毕后，再createDataChannel/addTrack，都需要重新negotiation。

