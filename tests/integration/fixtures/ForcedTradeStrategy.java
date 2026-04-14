package strategy;

import com.wualabs.qtsurfer.engine.core.state.StateStoreSupport;
import com.wualabs.qtsurfer.engine.indicators.helpers.WindowTimeRTIndicator.WindowTime;
import com.wualabs.qtsurfer.engine.indicators.helpers.group.InstrumentGroupRTIndicator;
import com.wualabs.qtsurfer.engine.strategy.AbstractOnChangeListener;
import com.wualabs.qtsurfer.engine.strategy.AbstractTickerStrategy;

public class ForcedTradeStrategy extends AbstractTickerStrategy {
    @Override
    protected void setupIndicators(InstrumentGroupRTIndicator indicators) {
        indicators.addPrice().window("price", WindowTime.s1,
            new TradeListener(indicators));
    }

    private class TradeListener extends AbstractOnChangeListener {
        public TradeListener(InstrumentGroupRTIndicator indicators) {
            super(ForcedTradeStrategy.this, indicators);
        }

        @Override
        public void onChange(StateStoreSupport store, double prev, double actual) {
            initStore(store);
            long count = this.store.inc("count");
            if (count % 120 == 60) {
                emitBuy(actual);
            } else if (count % 120 == 0) {
                emitSell(actual);
            }
        }
    }
}
