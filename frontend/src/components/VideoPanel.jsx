import { useEffect, useRef, useState } from 'react';

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export function VideoPanel({
  mode,
  conversationId,
  socket,
  userId,
  onClose,
  caller,
  mediaType = 'video',
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [visible, setVisible] = useState(false);
  const hasInvitedRef = useRef(false);

  useEffect(() => {
    if (!socket) return;
    const handler = async ({ conversationId: roomId, payload }) => {
      if (roomId !== conversationId) return;
      console.log('收到 WebRTC 信令:', payload.type, '当前状态:', status);
      
      if (payload.type === 'offer') {
        // 被叫方收到 offer
        await ensurePeer(false);
        await peerRef.current.setRemoteDescription({
          type: 'offer',
          sdp: payload.sdp,
        });
        const answer = await peerRef.current.createAnswer();
        await peerRef.current.setLocalDescription(answer);
        socket.emit('webrtc:signal', {
          conversationId,
          payload: { type: 'answer', sdp: answer.sdp },
        });
        console.log('已发送 answer');
      } else if (payload.type === 'answer' && peerRef.current) {
        // 主叫方收到 answer
        await peerRef.current.setRemoteDescription({
          type: 'answer',
          sdp: payload.sdp,
        });
        console.log('已设置远端 answer');
      } else if (payload.type === 'candidate' && peerRef.current) {
        await peerRef.current.addIceCandidate(payload.candidate);
        console.log('已添加 ICE candidate');
      }
    };
    socket.on('webrtc:signal', handler);
    return () => socket.off('webrtc:signal', handler);
  }, [socket, conversationId, status]);

  useEffect(() => {
    if (!visible) {
      stopMedia();
    }
  }, [visible, conversationId]);

  const ensurePeer = async (initiate) => {
    if (peerRef.current) return peerRef.current;
    const pc = new RTCPeerConnection(rtcConfig);
    peerRef.current = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket?.emit('webrtc:signal', {
          conversationId,
          payload: { type: 'candidate', candidate: event.candidate },
        });
      }
    };
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
      setStatus('connected');
    };

    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localVideoRef.current.srcObject = localStream;
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
    setStatus('connecting');

    if (initiate) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket?.emit('webrtc:signal', {
        conversationId,
        payload: { type: 'offer', sdp: offer.sdp, from: userId },
      });
    }
    return pc;
  };

  const stopMedia = () => {
    peerRef.current?.close();
    peerRef.current = null;
    [localVideoRef.current, remoteVideoRef.current].forEach((ref) => {
      ref?.srcObject?.getTracks().forEach((track) => track.stop());
      if (ref) ref.srcObject = null;
    });
    setStatus('idle');
  };

  const startOutgoingCall = () => {
    if (!conversationId || !socket || hasInvitedRef.current) return;
    socket.emit('call:invite', { conversationId, mediaType });
    setStatus('dialing');
    hasInvitedRef.current = true;
  };

  const acceptIncomingCall = async () => {
    if (!conversationId || !socket) return;
    socket.emit('call:accept', { conversationId });
    setStatus('connecting');
    // 等待主叫方的 offer，在 webrtc:signal 里处理
  };

  const declineIncomingCall = () => {
    socket?.emit('call:decline', { conversationId, reason: 'declined' });
    closePanel();
  };

  const closePanel = (silent = false) => {
    if (!silent) {
      socket?.emit('call:end', { conversationId });
    }
    stopMedia();
    onClose();
    setVisible(false);
    setStatus('idle');
    hasInvitedRef.current = false;
  };

  useEffect(() => {
    if (!socket || !conversationId) return;
    const handleRing = ({ conversationId: roomId, from }) => {
      if (roomId !== conversationId || mode !== 'incoming') return;
      setVisible(true);
      setStatus('ringing');
    };
    const handleAccept = async ({ conversationId: roomId }) => {
      if (roomId !== conversationId || mode !== 'outgoing') return;
      console.log('对方接听，开始发起 offer');
      await ensurePeer(true);
      setStatus('connecting');
    };
    const handleDecline = ({ conversationId: roomId }) => {
      if (roomId !== conversationId) return;
      setStatus('declined');
      closePanel(true);
    };
    const handleEnd = ({ conversationId: roomId }) => {
      if (roomId !== conversationId) return;
      closePanel(true);
    };

    socket.on('call:ring', handleRing);
    socket.on('call:accept', handleAccept);
    socket.on('call:decline', handleDecline);
    socket.on('call:end', handleEnd);

    if (mode === 'outgoing') {
      setVisible(true);
      startOutgoingCall();
    } else if (mode === 'incoming') {
      setVisible(true);
      setStatus('ringing');
    } else {
      setVisible(false);
    }

    return () => {
      socket.off('call:ring', handleRing);
      socket.off('call:accept', handleAccept);
      socket.off('call:decline', handleDecline);
      socket.off('call:end', handleEnd);
      hasInvitedRef.current = false;
    };
  }, [socket, conversationId, mode]);

  if (!visible) return null;

  const showCallingAnimation = status === 'dialing' || status === 'ringing';
  const callerName = caller?.name || '对方';
  const callerInitial = callerName.charAt(0).toUpperCase();

  return (
    <div className="video-modal">
      <div className="video-modal-content">
        <header>
          <div>
            <strong>{mediaType === 'video' ? '视频通话' : '语音通话'}</strong>
            <small>
              {status === 'ringing'
                ? '来电中...'
                : status === 'dialing'
                ? '呼叫中...'
                : status === 'connected'
                ? '通话中'
                : status === 'connecting'
                ? '连接中...'
                : '准备连接'}
            </small>
          </div>
          <button className="btn ghost" onClick={() => closePanel()}>
            ✕
          </button>
        </header>
        
        {showCallingAnimation ? (
          <div className="video-calling-animation">
            <div className="calling-avatar">{callerInitial}</div>
            <div className="calling-text">{callerName}</div>
            <div className="calling-status">
              {status === 'dialing' ? '正在呼叫...' : '邀请你视频通话'}
            </div>
          </div>
        ) : (
          <div className="video-grid">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <video ref={remoteVideoRef} autoPlay playsInline />
          </div>
        )}
        
        {mode === 'incoming' && status === 'ringing' ? (
          <div className="video-actions">
            <button className="btn primary" onClick={acceptIncomingCall}>
              接听
            </button>
            <button className="btn secondary" onClick={declineIncomingCall}>
              拒绝
            </button>
          </div>
        ) : (
          <div className="video-actions">
            <button className="btn secondary" onClick={() => closePanel()}>
              挂断
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

