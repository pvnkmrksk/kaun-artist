
import React, { useState, useEffect } from 'react';
import GameSetup from '@/components/GameSetup';
import PlayerConfig from '@/components/PlayerConfig';
import WordReveal from '@/components/WordReveal';
import DrawingCanvas from '@/components/DrawingCanvas';
import Voting from '@/components/Voting';
import Results from '@/components/Results';
import { Player, GameConfig, GamePhase, Stroke } from '@/types/game';
import { getRandomWord } from '@/data/wordsList';
import { useToast } from "@/hooks/use-toast";
import { useSocket } from '@/contexts/SocketContext';
import { useNavigate } from 'react-router-dom';

const Game: React.FC = () => {
  const [gamePhase, setGamePhase] = useState<GamePhase>('setup');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [secretWord, setSecretWord] = useState<string>('');
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [timerDuration, setTimerDuration] = useState<number>(30); // Default 30 seconds
  const [timerEnabled, setTimerEnabled] = useState<boolean>(false);
  const [startingPlayerOffset, setStartingPlayerOffset] = useState<number>(0);
  const { toast } = useToast();
  const { socket, roomId, leaveRoom } = useSocket();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    
    if (roomParam) {
      console.log("Found room param in URL:", roomParam);
      navigate('/', { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (!socket || !config?.isMultiplayer) return;

    const handleGameStateUpdate = (gameState: any) => {
      console.log("Received game state update:", gameState);
      if (gameState.players) setPlayers(gameState.players);
      if (gameState.gamePhase) setGamePhase(gameState.gamePhase);
      if (gameState.secretWord) setSecretWord(gameState.secretWord);
      if (gameState.currentRound) setCurrentRound(gameState.currentRound);
      if (gameState.strokes) setStrokes(gameState.strokes);
      if (gameState.votes) setVotes(gameState.votes);
      if (gameState.timerDuration !== undefined) setTimerDuration(gameState.timerDuration);
      if (gameState.timerEnabled !== undefined) setTimerEnabled(gameState.timerEnabled);
      if (gameState.startingPlayerOffset !== undefined) setStartingPlayerOffset(gameState.startingPlayerOffset);
    };

    const handlePlayerJoined = (newPlayer: any) => {
      console.log("Player joined event:", newPlayer);
      toast({
        title: "Player joined",
        description: `${newPlayer.name || 'A new player'} has joined the game`
      });
      
      if (newPlayer.clientId) {
        setPlayers(current => [
          ...current, 
          {
            id: current.length + 1,
            name: `Player ${current.length + 1}`,
            color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
            colorIndex: current.length % 8, // Add colorIndex property to match Player type
            isImposter: false,
            isOnline: true,
            clientId: newPlayer.clientId
          }
        ]);
      } else {
        setPlayers(current => [...current, newPlayer]);
      }
    };

    const handlePlayerLeft = (data: any) => {
      const playerId = data.playerId || data.clientId;
      console.log("Player left event:", data);
      
      // Find player by id or clientId, being careful with potential type issues
      const leavingPlayer = players.find(p => 
        p.id === playerId || (p as any).clientId === data.clientId
      );
      
      if (leavingPlayer) {
        toast({
          title: "Player left",
          description: `${leavingPlayer.name} has left the game`
        });
        
        setPlayers(current => current.filter(p => 
          p.id !== playerId && (p as any).clientId !== data.clientId
        ));
      }
    };

    socket.on('game-state-update', handleGameStateUpdate);
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);

    return () => {
      socket.off('game-state-update', handleGameStateUpdate);
      socket.off('player-joined', handlePlayerJoined);
      socket.off('player-left', handlePlayerLeft);
    };
  }, [socket, config?.isMultiplayer, players, toast]);

  useEffect(() => {
    if (players.length > 0 && !secretWord) {
      const word = getRandomWord();
      setSecretWord(word);
      
      if (config?.isMultiplayer && socket && config.isHost && roomId) {
        socket.emit('set-secret-word', { roomId, secretWord: word });
      }
    }
  }, [players, secretWord, config, socket, roomId]);

  const handleConfigSubmit = (newConfig: GameConfig) => {
    setConfig(newConfig);
    
    // Set timer settings if provided in config
    if (newConfig.timerEnabled && newConfig.timerDuration) {
      setTimerDuration(newConfig.timerDuration);
      setTimerEnabled(true);
    } else {
      setTimerEnabled(false);
    }
    
    if (newConfig.isMultiplayer) {
      if (newConfig.isHost && socket && roomId) {
        socket.emit('game-config', { 
          roomId, 
          config: newConfig 
        });
      }
    }
    
    setGamePhase('playerConfig');
  };

  const handlePlayersConfigured = (configuredPlayers: Player[]) => {
    // Assign truly random imposter
    const imposterIndex = Math.floor(Math.random() * configuredPlayers.length);
    
    console.log("Random imposter index:", imposterIndex);
    
    const playersWithImposter = configuredPlayers.map((player, index) => ({
      ...player,
      isImposter: index === imposterIndex,
      isOnline: config?.isMultiplayer || false
    }));
    
    setPlayers(playersWithImposter);
    setStartingPlayerOffset(0); // Reset starting player offset for first game
    setGamePhase('wordReveal');
    
    if (config?.isMultiplayer && socket && roomId && config.isHost) {
      socket.emit('players-configured', { 
        roomId, 
        players: playersWithImposter,
        startingPlayerOffset: 0
      });
    }
    
    toast({
      title: "Game starting!",
      description: `${configuredPlayers.length} players ready to play.`,
    });
  };

  const handleWordRevealComplete = () => {
    setGamePhase('drawing');
    
    if (config?.isMultiplayer && socket && roomId && config.isHost) {
      socket.emit('phase-change', { 
        roomId, 
        phase: 'drawing' 
      });
    }
  };

  const handleRoundComplete = (newStrokes: Stroke[]) => {
    const updatedStrokes = [...strokes, ...newStrokes];
    setStrokes(updatedStrokes);
    
    if (config?.isMultiplayer && socket && roomId && config.isHost) {
      socket.emit('round-complete', { 
        roomId, 
        strokes: updatedStrokes,
        currentRound
      });
    }
    
    if (config && currentRound < config.roundCount) {
      setCurrentRound(currentRound + 1);
      
      toast({
        title: "Round complete!",
        description: `Starting round ${currentRound + 1} of ${config.roundCount}`,
      });
      
      if (config?.isMultiplayer && socket && roomId && config.isHost) {
        socket.emit('next-round', { 
          roomId, 
          round: currentRound + 1 
        });
      }
    } else {
      setGamePhase('voting');
      
      if (config?.isMultiplayer && socket && roomId && config.isHost) {
        socket.emit('phase-change', { 
          roomId, 
          phase: 'voting' 
        });
      }
    }
  };

  const handleVotingComplete = (finalVotes: Record<number, number>) => {
    setVotes(finalVotes);
    setGamePhase('results');
    
    if (config?.isMultiplayer && socket && roomId && config.isHost) {
      socket.emit('voting-complete', { 
        roomId, 
        votes: finalVotes 
      });
      socket.emit('phase-change', { 
        roomId, 
        phase: 'results' 
      });
    }
  };

  const handlePlayAgain = () => {
    // Get a new word for the next game
    const word = getRandomWord();
    setSecretWord(word);
    setCurrentRound(1);
    setStrokes([]);
    setVotes({});
    
    // Update the starting player offset for rotation
    const newOffset = (startingPlayerOffset + 1) % players.length;
    setStartingPlayerOffset(newOffset);
    
    // Rotate players for next game - first player becomes last, with offset
    const rotatedPlayerOrder = [...players];
    for (let i = 0; i < newOffset; i++) {
      const firstPlayer = rotatedPlayerOrder.shift();
      if (firstPlayer) {
        rotatedPlayerOrder.push(firstPlayer);
      }
    }
    
    // Randomly select imposter for next game
    const imposterIndex = Math.floor(Math.random() * rotatedPlayerOrder.length);
    const updatedPlayers = rotatedPlayerOrder.map((player, index) => ({
      ...player,
      isImposter: index === imposterIndex
    }));
    
    setPlayers(updatedPlayers);
    setGamePhase('wordReveal');
    
    if (config?.isMultiplayer && socket && roomId && config.isHost) {
      socket.emit('play-again', { 
        roomId, 
        players: updatedPlayers,
        secretWord: word,
        startingPlayerOffset: newOffset
      });
    }
    
    toast({
      title: "New game starting!",
      description: "New word and roles assigned. Player order has been rotated.",
    });
  };

  const handleReturnHome = () => {
    if (config?.isMultiplayer) {
      leaveRoom();
    }
    
    setConfig(null);
    setPlayers([]);
    setSecretWord('');
    setCurrentRound(1);
    setStrokes([]);
    setVotes({});
    setGamePhase('setup');
    setStartingPlayerOffset(0);
  };

  return (
    <div className="min-h-screen">
      {gamePhase === 'setup' && (
        <GameSetup 
          onConfigSubmit={handleConfigSubmit} 
          initialTimerDuration={timerDuration}
          initialTimerEnabled={timerEnabled}
        />
      )}
      
      {gamePhase === 'playerConfig' && config && (
        <PlayerConfig 
          config={config}
          onPlayersConfigured={handlePlayersConfigured}
          isMultiplayer={config.isMultiplayer}
        />
      )}
      
      {gamePhase === 'wordReveal' && players.length > 0 && (
        <WordReveal 
          players={players}
          secretWord={secretWord}
          onComplete={handleWordRevealComplete}
          isMultiplayer={config?.isMultiplayer}
        />
      )}
      
      {gamePhase === 'drawing' && config && (
        <DrawingCanvas
          key={`drawing-round-${currentRound}`}
          players={players}
          currentRound={currentRound}
          totalRounds={config.roundCount}
          secretWord={secretWord}
          previousStrokes={strokes}
          onRoundComplete={handleRoundComplete}
          isMultiplayer={config.isMultiplayer}
          timerEnabled={timerEnabled}
          timerDuration={timerDuration}
        />
      )}
      
      {gamePhase === 'voting' && (
        <Voting
          players={players}
          secretWord={secretWord}
          strokes={strokes}
          onVotingComplete={handleVotingComplete}
          isMultiplayer={config?.isMultiplayer}
        />
      )}
      
      {gamePhase === 'results' && (
        <Results
          players={players}
          votes={votes}
          secretWord={secretWord}
          onPlayAgain={handlePlayAgain}
          onReturnHome={handleReturnHome}
          isMultiplayer={config?.isMultiplayer}
          strokes={strokes} // Pass strokes to show final drawing 
        />
      )}
    </div>
  );
};

export default Game;
