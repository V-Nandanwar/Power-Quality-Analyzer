/*
 * stm32f4xx_it.c — interrupt request handlers
 *
 * The HAL fires HAL_ADC_ConvHalfCpltCallback / HAL_ADC_ConvCpltCallback from
 * inside DMA2_Stream0_IRQHandler → HAL_DMA_IRQHandler → HAL_ADC handler. We
 * just need to dispatch the DMA interrupt to the HAL.
 */

#include "main.h"

extern DMA_HandleTypeDef hdma_adc1;

void NMI_Handler(void)        { while (1) {} }
void HardFault_Handler(void)  { while (1) {} }
void MemManage_Handler(void)  { while (1) {} }
void BusFault_Handler(void)   { while (1) {} }
void UsageFault_Handler(void) { while (1) {} }
void SVC_Handler(void)        { }
void DebugMon_Handler(void)   { }
void PendSV_Handler(void)     { }

void SysTick_Handler(void)
{
    HAL_IncTick();
}

void DMA2_Stream0_IRQHandler(void)
{
    HAL_DMA_IRQHandler(&hdma_adc1);
}
