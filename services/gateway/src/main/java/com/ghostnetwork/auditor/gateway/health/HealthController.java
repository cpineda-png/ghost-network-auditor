package com.ghostnetwork.auditor.gateway.health;

import com.ghostnetwork.auditor.gateway.api.dto.GatewayHealth;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final ZetarisStatusService zetarisStatusService;

    public HealthController(ZetarisStatusService zetarisStatusService) {
        this.zetarisStatusService = zetarisStatusService;
    }

    @GetMapping("/health")
    public GatewayHealth health() {
        return new GatewayHealth(zetarisStatusService.zetaris(), zetarisStatusService.mode());
    }
}
