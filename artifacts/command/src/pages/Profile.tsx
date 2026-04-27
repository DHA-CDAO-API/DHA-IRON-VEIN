import React, { useEffect } from 'react';
import { useGetProfile, useUpdateProfile, useListRoles, getGetProfileQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserCircle, Shield, Map, Activity, Database, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

export default function Profile() {
  const { data: profile, isLoading } = useGetProfile();
  const { data: roles } = useListRoles();
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: {
      name: '',
      base: '',
      role: ''
    }
  });

  useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name,
        base: profile.base,
        role: profile.role
      });
    }
  }, [profile, form]);

  const handleRoleSelect = (roleId: string) => {
    form.setValue('role', roleId);
    updateProfile.mutate({ data: { role: roleId as any } }, {
      onSuccess: () => {
        toast({ title: 'Role Switched', description: 'Dashboard reloaded with new perspective.' });
        queryClient.invalidateQueries(); // Invalidate all to refresh view
      }
    });
  };

  const onSubmit = (data: any) => {
    updateProfile.mutate({ data: { name: data.name, base: data.base } }, {
      onSuccess: () => {
        toast({ title: 'Profile Updated' });
        queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      }
    });
  };

  if (isLoading) return <div className="p-6">Loading...</div>;

  const roleIcons: Record<string, any> = {
    commander: Shield,
    logistician: Map,
    medical_planner: Activity,
    analyst: Database
  };

  return (
    <div className="h-full flex flex-col p-6 bg-background overflow-y-auto max-w-5xl mx-auto w-full">
      <h1 className="text-2xl font-bold uppercase tracking-wider mb-8">Personnel Profile</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Col - Info */}
        <Card className="bg-card/50 border-border h-fit">
          <CardContent className="p-6 flex flex-col items-center">
            <UserCircle className="h-24 w-24 text-muted-foreground mb-4" />
            <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-4">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input {...form.register('name')} className="bg-background/50 text-center" />
              </div>
              <div className="space-y-2">
                <Label>Theater Assignment / Base</Label>
                <Input {...form.register('base')} className="bg-background/50 text-center" />
              </div>
              <Button type="submit" className="w-full" disabled={updateProfile.isPending}>
                Update Info
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Right Col - Role Switcher */}
        <div className="md:col-span-2 space-y-4">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" /> Active Perspective (Role)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {roles?.map(role => {
              const Icon = roleIcons[role.id] || UserCircle;
              const isActive = form.watch('role') === role.id;
              
              return (
                <Card 
                  key={role.id} 
                  className={`cursor-pointer transition-all duration-200 border-2 ${isActive ? 'bg-primary/10 border-primary shadow-[0_0_15px_rgba(0,255,255,0.1)]' : 'bg-card/50 border-border hover:border-primary/50'}`}
                  onClick={() => !isActive && handleRoleSelect(role.id)}
                >
                  <CardContent className="p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div className={`p-2 rounded-lg ${isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      {isActive && <Check className="h-5 w-5 text-primary" />}
                    </div>
                    <h3 className="font-bold text-lg mb-1">{role.label}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">{role.description}</p>
                    <div className="mt-4 pt-3 border-t border-border/50 flex flex-wrap gap-1">
                      {role.focus.map((f, i) => (
                        <span key={i} className="text-[10px] uppercase tracking-wider bg-secondary px-2 py-0.5 rounded text-muted-foreground">{f}</span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
