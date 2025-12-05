import { useEffect, useRef, useState, useCallback } from 'react';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const CALL_STATES = {
  IDLE: 'idle',
  DIALING: 'dialing',
  RINGING: 'ringing',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ENDED: 'ended',
};

export function VideoCall({ mode, conversationId, socket, userId, onClose, caller }) {
  const [callState, setCallState] = useState(CALL_STATES.IDLE);
  const [visible, setVisible] = useState(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  const cleanup = useCallback(() => {
    console.log('[VideoCall] cleanup');
    
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    
    pendingCandidatesRef.current = [];
  }, []);

  const getLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      console.log('[VideoCall] got local media stream');
      return stream;
    } catch (error) {
      console.error('[VideoCall] failed to get media:', error);
      alert('Cannot access camera/microphone, please check permissions');
      throw error;
    }
  }, []);

  const createPeerConnection = useCallback(async () => {
    if (peerRef.current) {
      console.log('[VideoCall] PeerConnection already exists');
      return peerRef.current;
    }

    console.log('[VideoCall] creating PeerConnection');
    const pc = new RTCPeerConnection(rtcConfig);
    peerRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        console.log('[VideoCall] sending ICE candidate');
        socket.emit('webrtc:signal', {
          conversationId,
          payload: { type: 'candidate', candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('[VideoCall] received remote stream');
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setCallState(CALL_STATES.CONNECTED);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[VideoCall] connection state:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.error('[VideoCall] connection failed');
        handleEnd();
      }
    };

    const stream = await getLocalStream();
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    return pc;
  }, [conversationId, socket, getLocalStream]);

  const startCall = useCallback(async () => {
    if (!socket || !conversationId) return;
    
    console.log('[VideoCall] caller: start call');
    setCallState(CALL_STATES.DIALING);
    socket.emit('call:invite', { conversationId });
  }, [socket, conversationId]);

  const acceptCall = useCallback(async () => {
    if (!socket || !conversationId) return;
    
    console.log('[VideoCall] callee: accept call');
    setCallState(CALL_STATES.CONNECTING);
    socket.emit('call:accept', { conversationId });
  }, [socket, conversationId]);

  const handleEnd = useCallback(() => {
    console.log('[VideoCall] hang up call');
    if (socket && conversationId && callState !== CALL_STATES.IDLE) {
      socket.emit('call:end', { conversationId });
    }
    cleanup();
    setCallState(CALL_STATES.ENDED);
    setVisible(false);
    onClose();
  }, [socket, conversationId, callState, cleanup, onClose]);

  useEffect(() => {
    if (!socket) return;

    const handleSignal = async ({ conversationId: roomId, payload }) => {
      if (roomId !== conversationId) return;
      
      console.log('[VideoCall] received signaling:', payload.type);

      try {
        if (payload.type === 'offer') {
          const pc = await createPeerConnection();
          await pc.setRemoteDescription(new RTCSessionDescription({
            type: 'offer',
            sdp: payload.sdp,
          }));
          
          for (const candidate of pendingCandidatesRef.current) {
            await pc.addIceCandidate(candidate);
          }
          pendingCandidatesRef.current = [];
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          socket.emit('webrtc:signal', {
            conversationId,
            payload: { type: 'answer', sdp: answer.sdp },
          });
          console.log('[VideoCall] sent answer');
          
        } else if (payload.type === 'answer') {
          if (!peerRef.current) {
            console.error('[VideoCall] PeerConnection does not exist');
            return;
          }
          await peerRef.current.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: payload.sdp,
          }));
          console.log('[VideoCall] answer set');
          
        } else if (payload.type === 'candidate') {
          if (peerRef.current && peerRef.current.remoteDescription) {
            await peerRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
            console.log('[VideoCall] added candidate');
          } else {
            pendingCandidatesRef.current.push(new RTCIceCandidate(payload.candidate));
            console.log('[VideoCall] queued candidate');
          }
        }
      } catch (error) {
        console.error('[VideoCall] signaling handling failed:', error);
      }
    };

    socket.on('webrtc:signal', handleSignal);
    return () => socket.off('webrtc:signal', handleSignal);
  }, [socket, conversationId, createPeerConnection]);

  useEffect(() => {
    if (!socket) return;

    const handleRing = ({ conversationId: roomId }) => {
      if (roomId !== conversationId || mode !== 'incoming') return;
      console.log('[VideoCall] incoming call');
      setVisible(true);
      setCallState(CALL_STATES.RINGING);
    };

    const handleAccept = async ({ conversationId: roomId }) => {
      if (roomId !== conversationId || mode !== 'outgoing') return;
      console.log('[VideoCall] other side accepted, sending offer');
      
      setCallState(CALL_STATES.CONNECTING);
      const pc = await createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('webrtc:signal', {
        conversationId,
        payload: { type: 'offer', sdp: offer.sdp },
      });
    };

    const handleDecline = ({ conversationId: roomId }) => {
      if (roomId !== conversationId) return;
      console.log('[VideoCall] other side declined');
      handleEnd();
    };

    const handleCallEnd = ({ conversationId: roomId }) => {
      if (roomId !== conversationId) return;
      console.log('[VideoCall] other side hung up');
      handleEnd();
    };

    socket.on('call:ring', handleRing);
    socket.on('call:accept', handleAccept);
    socket.on('call:decline', handleDecline);
    socket.on('call:end', handleCallEnd);

    return () => {
      socket.off('call:ring', handleRing);
      socket.off('call:accept', handleAccept);
      socket.off('call:decline', handleDecline);
      socket.off('call:end', handleCallEnd);
    };
  }, [socket, conversationId, mode, createPeerConnection, handleEnd]);

  useEffect(() => {
    if (mode === 'outgoing') {
      setVisible(true);
      startCall();
    } else if (mode === 'incoming') {
      setVisible(true);
      setCallState(CALL_STATES.RINGING);
    } else {
      setVisible(false);
    }

    return () => {
      cleanup();
    };
  }, [mode, startCall, cleanup]);

  if (!visible) return null;

  const showAnimation = callState === CALL_STATES.DIALING || callState === CALL_STATES.RINGING;
  const callerName = caller?.name || 'Peer';
  const callerInitial = callerName.charAt(0).toUpperCase();

  return (
    <div className="video-modal">
      <div className="video-modal-content">
        <header>
          <div>
            <strong>Video call</strong>
            <small>
              {callState === CALL_STATES.RINGING && 'Incoming call...'}
              {callState === CALL_STATES.DIALING && 'Calling...'}
              {callState === CALL_STATES.CONNECTING && 'Connecting...'}
              {callState === CALL_STATES.CONNECTED && 'In call'}
            </small>
          </div>
          <button className="btn ghost" onClick={handleEnd}>✕</button>
        </header>

        {showAnimation ? (
          <div className="video-calling-animation">
            <div className="calling-avatar">{callerInitial}</div>
            <div className="calling-text">{callerName}</div>
            <div className="calling-status">
              {callState === CALL_STATES.DIALING ? 'Calling...' : 'Invites you to a video call'}
            </div>
          </div>
        ) : (
          <div className="video-grid">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <video ref={remoteVideoRef} autoPlay playsInline />
          </div>
        )}

        {callState === CALL_STATES.RINGING && mode === 'incoming' ? (
          <div className="video-actions">
            <button className="btn primary" onClick={acceptCall}>Accept</button>
            <button className="btn secondary" onClick={handleEnd}>Decline</button>
          </div>
        ) : (
          <div className="video-actions">
            <button className="btn secondary" onClick={handleEnd}>Hang up</button>
          </div>
        )}
      </div>
    </div>
  );
}

