import { useNavigate, useParams } from 'react-router-dom';
import { DebugLobby } from '../components/DebugLobby';

export function DebugPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId?: string }>();
  return <DebugLobby onExit={() => navigate('/debug')} initialRoomId={roomId} />;
}
