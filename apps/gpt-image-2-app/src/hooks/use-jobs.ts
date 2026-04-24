import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GenerateRequest, Job } from "@/lib/types";

export function useJobs() {
  return useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: api.listJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data as Job[] | undefined;
      return jobs?.some(
        (job) => job.status === "queued" || job.status === "running",
      )
        ? 1_500
        : 8_000;
    },
  });
}

export function useJob(id?: string) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => api.getJob(id!),
    enabled: !!id,
  });
}

export function useCreateGenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateRequest) => api.createGenerate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useCreateEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.createEdit(form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
