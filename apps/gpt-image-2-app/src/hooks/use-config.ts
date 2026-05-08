import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  JobStatus,
  NotificationConfig,
  ProviderConfig,
  ServerConfig,
} from "@/lib/types";

export function useConfig() {
  return useQuery<ServerConfig>({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });
}

export function useSetDefaultProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.setDefault(name),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, cfg }: { name: string; cfg: ProviderConfig }) =>
      api.upsertProvider(name, cfg),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteProvider(name),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useTestProvider() {
  return useMutation({ mutationFn: (name: string) => api.testProvider(name) });
}

export function useUpdateNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: NotificationConfig) => api.updateNotifications(config),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useNotificationCapabilities() {
  return useQuery({
    queryKey: ["notification-capabilities"],
    queryFn: api.notificationCapabilities,
    staleTime: 60_000,
  });
}

export function useTestNotifications() {
  return useMutation({
    mutationFn: (status?: JobStatus) => api.testNotifications(status),
  });
}
