import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  JobStatus,
  LoggingConfig,
  LogLevel,
  LogsResult,
  NotificationConfig,
  PathConfig,
  ProviderConfig,
  ServerConfig,
  StorageConfig,
  StorageTargetConfig,
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

export function useUpdatePaths() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: PathConfig) => {
      if (!api.updatePaths) {
        throw new Error("当前运行环境不支持修改本机路径。");
      }
      return api.updatePaths(config);
    },
    onSuccess: (data) => {
      qc.setQueryData(["config"], data);
      void qc.invalidateQueries({ queryKey: ["config-paths"] });
    },
  });
}

export function useUpdateStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: StorageConfig) => {
      if (!api.updateStorage) {
        throw new Error("当前运行环境不支持修改存储配置。");
      }
      return api.updateStorage(config);
    },
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useTestStorageTarget() {
  return useMutation({
    mutationFn: ({
      name,
      target,
    }: {
      name: string;
      target?: StorageTargetConfig;
    }) => {
      if (!api.testStorageTarget) {
        throw new Error("当前运行环境不支持测试存储目标。");
      }
      return api.testStorageTarget(name, target);
    },
  });
}

export function useLogs(options?: {
  level?: LogLevel;
  limit?: number;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  const level = options?.level;
  const limit = options?.limit ?? 500;
  return useQuery<LogsResult>({
    // level is part of the key so switching the filter re-fetches a
    // server-side filtered slice instead of just client-filtering.
    queryKey: ["logs", level ?? "all", limit],
    queryFn: () => api.getLogs({ level, limit }),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 2_000,
  });
}

export function useUpdateLogging() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: LoggingConfig) => api.updateLogging(config),
    onSuccess: (data) => {
      qc.setQueryData(["config"], data);
      // Verbose toggle changes which entries get persisted going forward;
      // refresh the panel so the effect is visible.
      void qc.invalidateQueries({ queryKey: ["logs"] });
    },
  });
}

export function useOpenLogsDir() {
  return useMutation({
    mutationFn: () => {
      if (!api.openLogsDir) {
        throw new Error("当前运行环境不支持打开日志文件夹。");
      }
      return api.openLogsDir();
    },
  });
}
