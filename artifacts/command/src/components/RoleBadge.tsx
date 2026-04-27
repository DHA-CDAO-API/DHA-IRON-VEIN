import React from 'react';
import { useGetProfile } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Shield, Activity, Map, Database } from 'lucide-react';
import { Link } from 'wouter';

export default function RoleBadge() {
  const { data: profile } = useGetProfile();

  if (!profile) return null;

  const roleIcons: Record<string, React.ReactNode> = {
    commander: <Shield className="h-3 w-3 mr-1" />,
    logistician: <Box className="h-3 w-3 mr-1" />,
    medical_planner: <Activity className="h-3 w-3 mr-1" />,
    analyst: <Database className="h-3 w-3 mr-1" />
  };

  const getIcon = () => {
    switch (profile.role) {
      case 'commander': return <Shield className="h-3 w-3 mr-1" />;
      case 'logistician': return <Map className="h-3 w-3 mr-1" />;
      case 'medical_planner': return <Activity className="h-3 w-3 mr-1" />;
      case 'analyst': return <Database className="h-3 w-3 mr-1" />;
      default: return null;
    }
  };

  return (
    <Link href="/profile">
      <Badge variant="outline" className="cursor-pointer hover:bg-secondary transition-colors border-primary/50 text-primary uppercase text-[10px] tracking-wider px-2 py-0.5 flex items-center">
        {getIcon()}
        {profile.role.replace('_', ' ')}
      </Badge>
    </Link>
  );
}

// Add local Box import since we didn't import Box from lucide-react above.
import { Box } from 'lucide-react';